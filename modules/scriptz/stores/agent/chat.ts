import { createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { t } from "../../i18n";
import { api } from "../../lib/api";
import { effortOrDefault } from "../../lib/agent/codex/provider";
import { getChat, saveChat, type ChatItem, type ChatKind, type ChatRecord, type SavedIdeaRef } from "../../lib/agent/chats";
import type { InstructionMode } from "../../lib/agent/prompt";
import { createChatTools, type ToolHost } from "../../lib/agent/tools";
import type { AgentThread, AgentTool } from "../../lib/agent/types";
import { createSessionTools, existingFolder, ideaNotes, type IdeaBoardRef, type SessionToolHost } from "../../lib/agent/sessionTools";
import { agentSettings } from "../agentSettings";
import { applyBlocks, liveBlocks, readSelection, revealBlock, targetIndex } from "../../components/Agent/editorBridge";
import { ensureModels, getProvider, resolveModel } from "./provider";
import { chatInstructions, currentPace, sessionPreamble } from "./instructions";
import { applyEvent, finishStreaming, localId, memoryItem, undoMemoryChange } from "./chatItems";
import { byChat, byScript, chatsChanged } from "./registry";
import { bumpSessions } from "./sessionList";
import type { ChatSession } from "./types";

// ---------------------------------------------------------------------------
// One live chat: items, provider thread, serial writes and all user actions.
// ---------------------------------------------------------------------------

const SESSION_TITLE_MAX = 80;

export function sessionTitleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > SESSION_TITLE_MAX ? `${line.slice(0, SESSION_TITLE_MAX - 1).trimEnd()}…` : line;
}

export type ChatSource =
  /** `record`: the script's newest chat, already loaded (or none yet). */
  | { kind: "script"; scriptId: string; record: ChatRecord | null }
  | { kind: "session"; chatId: string; folderId?: string | null };

export function createChat(source: ChatSource): ChatSession {
  const [state, setState] = createStore<{ items: ChatItem[] }>({ items: [] });
  const [running, setRunning] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const [chatId, setChatId] = createSignal<string>(source.kind === "session" ? source.chatId : source.record?.id ?? crypto.randomUUID());
  const [kind, setKind] = createSignal<ChatKind>(source.kind);
  const [scriptId, setScriptId] = createSignal<string | null>(source.kind === "script" ? source.scriptId : null);
  const [title, setTitle] = createSignal<string | null>(null);
  const [folderId, setFolderId] = createSignal<string | null>(source.kind === "session" ? source.folderId ?? null : null);
  let record: ChatRecord | null = null;
  let thread: AgentThread | null = null;
  // Instructions of the open thread were built for this mode; a change
  // (handed to a script) reopens the thread on the next message.
  let threadMode: InstructionMode | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // Writes run one after another so an older snapshot never lands last.
  let writes: Promise<void> = Promise.resolve();
  let writeError: unknown = null;
  // Bumped by "New chat": a turn from before must not touch the new chat.
  let epoch = 0;
  // Set before the row is deleted: nothing may write it again.
  let discarded = false;
  // The saved chat could not be read: writing would replace it with what
  // little is in memory, so this object stays read-only. It is not kept in
  // the registry, so opening the session again loads it anew.
  let loadFailed = false;

  const loading = (source.kind === "script" ? Promise.resolve(source.record) : getChat(source.chatId)).then((chat) => {
    if (!chat) return;
    record = chat;
    setChatId(chat.id);
    setKind(chat.kind);
    setScriptId(chat.scriptId);
    setTitle(chat.title);
    // A folder chosen before the saved chat arrived wins.
    if (source.kind !== "session" || source.folderId === undefined) setFolderId(chat.folderId);
    setState("items", reconcile(chat.items));
  }).catch((error) => {
    console.warn("[agent] loading chat failed", error);
    loadFailed = true;
    push({ kind: "error", id: localId("err"), message: t("agentMode.loadFailed") });
    // Silently: announcing it would make views ask again at once and retry
    // in a loop while the database stays unreadable. Also as a script's
    // chat: the panel may have picked it up meanwhile.
    if (byChat.get(chatId()) === session) byChat.delete(chatId());
    for (const [key, value] of byScript) if (value === session) byScript.delete(key);
  }).finally(() => {
    // One live object per chat row; never replace another one.
    if (!loadFailed && !byChat.has(chatId())) {
      byChat.set(chatId(), session);
      chatsChanged();
    }
    setReady(true);
  });

  const write = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (discarded || loadFailed) return;
    // An untouched session is not stored (no empty rows in the list).
    if (kind() === "session" && state.items.length === 0 && !record) return;
    const now = Date.now();
    if (!record) {
      record = {
        id: chatId(), kind: kind(), scriptId: scriptId(), provider: "codex", threadId: thread?.id ?? null,
        title: title(), folderId: folderId(), items: [], createdAt: now, updatedAt: now,
      };
    }
    record = {
      ...record,
      kind: kind(),
      scriptId: scriptId(),
      title: title(),
      folderId: folderId(),
      threadId: thread?.id ?? record.threadId,
      items: JSON.parse(JSON.stringify(state.items)) as ChatItem[],
      updatedAt: now,
    };
    const snapshot = record;
    writes = writes.then(() => saveChat(snapshot)).then(
      () => { writeError = null; if (snapshot.kind === "session") bumpSessions(); },
      (error: unknown) => { writeError = error; console.warn("[agent] saving chat failed", error); },
    );
  };

  const persist = (immediate = false) => {
    if (saveTimer) clearTimeout(saveTimer);
    if (immediate) write();
    else saveTimer = setTimeout(write, 400);
  };

  /** The chat row exists before anything points at it (ideas carry the
   *  session as `source_chat_id`, a foreign key). */
  const ensureStored = async () => {
    if (loadFailed) throw new Error("chat could not be loaded");
    if (saveTimer || !record) write();
    await writes;
    if (writeError) throw writeError;
  };

  const push = (item: ChatItem) => setState("items", (items) => [...items, item]);
  const indexOf = (id: string) => state.items.findIndex((item) => item.id === id);

  const lastBoard = (): IdeaBoardRef | null => {
    for (let i = state.items.length - 1; i >= 0; i--) {
      const item = state.items[i];
      if (item.kind === "ideas") return { itemId: item.id, folderId: item.folderId, ideas: item.ideas, savedIds: item.savedIds };
    }
    return null;
  };

  const markBoardSaved = (boardId: string, indices: readonly number[], saved: readonly SavedIdeaRef[]) => {
    const i = indexOf(boardId);
    if (i < 0) return;
    setState("items", i, produce((draft) => {
      if (draft.kind !== "ideas") return;
      indices.forEach((index, k) => { draft.savedIds[index] = saved[k]?.ideaId ?? draft.savedIds[index]; });
      draft.picked = draft.picked.filter((p) => !indices.includes(p));
    }));
  };

  const host: ToolHost & SessionToolHost = {
    get scriptId() { return scriptId(); },
    liveBlocks: () => liveBlocks(scriptId()),
    selection: () => readSelection(scriptId()),
    onProposal: (proposal) => push({ kind: "proposal", id: localId("proposal"), proposal, applied: null }),
    onClaims: (claims) => push({ kind: "claims", id: localId("claims"), claims, applied: [] }),
    onMemory: (change) => push(memoryItem(change)),
    memorySource: "chat",
    memorySourceScriptId: null,
    chatId,
    folderId,
    pace: currentPace,
    ensureStored,
    onIdeas: (board) => push({
      kind: "ideas", id: localId("ideas"), folderId: board.folderId, ideas: board.ideas,
      picked: [], savedIds: board.ideas.map(() => null),
    }),
    onIdeasSaved: (saved, savedFolder, board) => {
      if (board) markBoardSaved(board.itemId, board.indices, saved);
      push({ kind: "ideas-saved", id: localId("saved"), folderId: savedFolder, saved });
    },
    onReplies: (replies) => push({ kind: "replies", id: localId("replies"), replies }),
    lastBoard,
  };

  const modeNow = (): InstructionMode => (scriptId() ? (kind() === "session" ? "handed-over" : "script") : "session");

  const toolsFor = (mode: InstructionMode): AgentTool[] => {
    const chat = createChatTools(host);
    if (mode === "script") return chat;
    const sessionTools = createSessionTools(host);
    // Without an open script the script-bound tools cannot work.
    if (mode === "session") return [...chat.filter((tool) => !SCRIPT_ONLY_TOOLS.has(tool.name)), ...sessionTools];
    return [...chat, ...sessionTools.filter((tool) => tool.name !== "propose_ideas")];
  };

  const ensureThread = async (): Promise<AgentThread> => {
    const mode = modeNow();
    if (thread && threadMode === mode) return thread;
    const p = getProvider();
    if (!p) throw new Error("agent unavailable");
    await loading;
    const resumeFrom = thread?.id ?? record?.threadId ?? null;
    if (thread) {
      // Mode changed (handed to a script): unload the thread so resuming
      // picks up the new instructions and tools; the history stays.
      const old = thread;
      thread = null;
      threadMode = null;
      await old.close().catch(() => {});
    }
    const opening = epoch;
    const opened = await p.openThread({
      instructions: await chatInstructions(scriptId(), mode, folderId()),
      tools: toolsFor(mode),
      resumeId: resumeFrom,
    });
    // "New chat" meanwhile: this thread belongs to the old conversation.
    if (opening !== epoch) {
      void opened.close().catch(() => {});
      throw new Error("chat was reset");
    }
    thread = opened;
    threadMode = mode;
    return thread;
  };

  const session: ChatSession = {
    chatId,
    kind,
    scriptId,
    title,
    folderId,
    setFolder(next) {
      if (folderId() === next) return;
      setFolderId(next);
      if (record || state.items.length) persist();
    },
    get items() { return state.items; },
    running,
    ready,
    async send(text, quote, options) {
      const clean = text.trim();
      if (!clean || running()) return;
      setRunning(true);
      const turn = epoch;
      const live = () => turn === epoch;
      // The saved chat must be in place first, or loading would replace
      // the new message.
      await loading;
      if (!live()) return;
      if (loadFailed) {
        setRunning(false);
        return;
      }
      if (kind() === "session" && !title()) setTitle(sessionTitleFrom(clean));
      // Quick replies belong to the turn before; answering ends them.
      setState("items", (items) => items.filter((item) => item.kind !== "replies"));
      push({ kind: "user", id: localId("user"), text: clean, quote: quote?.text, ...(options?.job ? { job: options.job } : {}) });
      persist();
      try {
        const list = await ensureModels();
        // Deleted or reset while preparing: no hidden turn afterwards.
        if (!live() || discarded) return;
        const model = resolveModel(list, agentSettings.model());
        const active = await ensureThread();
        if (!live() || discarded) return;
        let input = options?.instruction?.trim() || clean;
        if (quote) {
          input = quote.draft !== undefined
            ? `Selected passage of the draft "${quote.draft}":\n"""${quote.text}"""\n\n${input}`
            : `Selected passage (blocks ${quote.from}-${quote.to} of the current script):\n"""${quote.text}"""\n\n${input}`;
        }
        if (options?.hint) input = `${input}\n\n(${options.hint})`;
        if (modeNow() === "session") input = `${await sessionPreamble(folderId, () => state.items)}\n\n${input}`;
        const result = await active.run(input, {
          model: model?.id ?? "",
          effort: effortOrDefault(model, agentSettings.effort()),
        }, (event) => { if (live()) applyEvent(setState, event); });
        if (!live()) return;
        if (result.status === "interrupted") push({ kind: "interrupted", id: localId("int") });
        if (result.status === "failed") {
          push({ kind: "error", id: localId("err"), message: result.error ?? "" });
          // Resume the saved thread on the next message (e.g. after a crash).
          thread = null;
        }
      } catch (error) {
        if (!live()) return;
        push({ kind: "error", id: localId("err"), message: error instanceof Error ? error.message : String(error) });
        // A broken thread is re-opened on the next message.
        thread = null;
      } finally {
        // After "New chat" the reset owns the state; the old turn leaves it alone.
        if (live()) {
          finishStreaming(setState);
          setRunning(false);
          persist(true);
        }
      }
    },
    async stop() {
      await thread?.interrupt();
    },
    async reset() {
      epoch += 1;
      const old = thread;
      thread = null;
      threadMode = null;
      if (running()) await old?.interrupt();
      await old?.close().catch(() => {});
      await loading;
      await writes;
      // A handed-over session stays in the session list; the script gets a
      // fresh chat of its own from here on.
      if (byChat.get(chatId()) === session) byChat.delete(chatId());
      record = null;
      // A fresh row: nothing stored can be overwritten any more.
      loadFailed = false;
      setChatId(crypto.randomUUID());
      setKind(scriptId() ? "script" : kind());
      setTitle(null);
      byChat.set(chatId(), session);
      chatsChanged();
      setState("items", []);
      setRunning(false);
      write();
    },
    async flush() {
      if (saveTimer) write();
      await writes;
      if (writeError) throw writeError;
    },
    release() {
      // Not close(): that may spawn a process just to unsubscribe. Disposing
      // the provider ends any running turn.
      thread = null;
      threadMode = null;
    },
    applyOption(itemId, index) {
      const id = scriptId();
      const i = indexOf(itemId);
      const item = state.items[i];
      if (!id || !item || item.kind !== "proposal") return false;
      const option = item.proposal.options[index];
      const target = option ? applyBlocks(id, option.blocks, item.proposal.target) : null;
      if (!option || !target) return false;
      revealBlock(id, targetIndex(id, target, option.blocks.length));
      setState("items", i, produce((draft) => { if (draft.kind === "proposal") draft.applied = index; }));
      persist(true);
      return true;
    },
    applyFix(itemId, index) {
      const id = scriptId();
      const i = indexOf(itemId);
      const item = state.items[i];
      if (!id || !item || item.kind !== "claims") return false;
      const fix = item.claims[index]?.fix;
      const target = fix ? applyBlocks(id, fix.blocks, fix.target) : null;
      if (!fix || !target) return false;
      revealBlock(id, targetIndex(id, target, fix.blocks.length));
      setState("items", i, produce((draft) => { if (draft.kind === "claims") draft.applied = [...draft.applied, index]; }));
      persist(true);
      return true;
    },
    append(items) {
      // After loading, so the restored chat does not replace these items.
      void loading.then(() => {
        for (const item of items) push(item);
        persist();
      });
    },
    async undoMemory(itemId) {
      const i = indexOf(itemId);
      const item = state.items[i];
      if (!item || item.kind !== "memory" || item.undone) return;
      await undoMemoryChange(item);
      setState("items", i, produce((draft) => { if (draft.kind === "memory") draft.undone = true; }));
      persist(true);
    },
    togglePick(itemId, index) {
      const i = indexOf(itemId);
      const item = state.items[i];
      if (!item || item.kind !== "ideas" || index < 0 || index >= item.ideas.length || item.savedIds[index]) return;
      setState("items", i, produce((draft) => {
        if (draft.kind !== "ideas") return;
        draft.picked = draft.picked.includes(index) ? draft.picked.filter((p) => p !== index) : [...draft.picked, index].sort((a, b) => a - b);
      }));
      persist();
    },
    async saveIdeas(itemId, indices) {
      const i = indexOf(itemId);
      const item = state.items[i];
      if (!item || item.kind !== "ideas") return 0;
      const todo = [...new Set(indices)].filter((index) => index >= 0 && index < item.ideas.length && !item.savedIds[index]).sort((a, b) => a - b);
      if (todo.length === 0) return 0;
      // The board's folder decides (null = "no folder"); a folder deleted
      // since then falls back to none.
      const target = await existingFolder(item.folderId);
      await ensureStored();
      const saved: SavedIdeaRef[] = [];
      const done: number[] = [];
      try {
        for (const index of todo) {
          const card = item.ideas[index];
          const idea = await api.createIdea({ title: card.title, notes: ideaNotes(card), folderId: target, sourceChatId: chatId() });
          saved.push({ ideaId: idea.id, title: idea.title, number: index + 1 });
          done.push(index);
        }
      } finally {
        if (saved.length) {
          markBoardSaved(itemId, done, saved);
          push({ kind: "ideas-saved", id: localId("saved"), folderId: target, saved });
          persist(true);
        }
      }
      return saved.length;
    },
    async undoSavedIdeas(itemId) {
      const i = indexOf(itemId);
      const item = state.items[i];
      if (!item || item.kind !== "ideas-saved" || item.undone) return;
      // Without a reliable list nothing is changed.
      const list = await api.listIdeas().catch(() => null);
      if (!list) return;
      const current = new Map(list.map((idea) => [idea.id, idea]));
      const removed = new Set<string>();
      try {
        for (const ref of item.saved) {
          const idea = current.get(ref.ideaId);
          // An idea that meanwhile became a script stays, with its marker.
          if (idea?.used_at) continue;
          if (idea) await api.deleteIdea(ref.ideaId);
          removed.add(ref.ideaId);
        }
      } finally {
        // Whatever was not removed (also after a failed delete) keeps its
        // marker and stays on the receipt.
        const remaining = item.saved.filter((ref) => !removed.has(ref.ideaId));
        setState("items", produce((items) => {
          for (const entry of items) {
            if (entry.id === itemId && entry.kind === "ideas-saved") {
              if (remaining.length === 0) entry.undone = true;
              else entry.saved = remaining;
            }
            if (entry.kind === "ideas") entry.savedIds = entry.savedIds.map((id) => (id && removed.has(id) ? null : id));
          }
        }));
        persist(true);
      }
    },
    discardDraft(slug, versionId) {
      push({ kind: "draft-discarded", id: localId("discard"), slug, versionId });
      persist(true);
    },
    recordHandoff(entry) {
      push({ kind: "handoff", id: localId("handoff"), at: Date.now(), ...entry });
      persist(true);
    },
    async attachToScript(target, targetFolder) {
      await loading;
      const previous = scriptId();
      if (previous === target) return;
      // Session tools and the writing context follow the script's folder.
      setFolderId(targetFolder);
      if (previous && byScript.get(previous) === session) byScript.delete(previous);
      // The script is new, but a chat opened meanwhile must not compete.
      const other = byScript.get(target);
      if (other && other !== session) {
        other.release();
        byScript.delete(target);
      }
      setScriptId(target);
      byScript.set(target, session);
      chatsChanged();
      // The next message reopens the provider thread with script
      // instructions and tools (ensureThread sees the new mode).
      persist(true);
      await writes;
    },
    detachFromScript() {
      const previous = scriptId();
      if (!previous) return;
      if (byScript.get(previous) === session) byScript.delete(previous);
      setScriptId(null);
      chatsChanged();
      if (record) record = { ...record, scriptId: null };
    },
    forgetFolder() {
      if (folderId() === null) return;
      setFolderId(null);
      if (record) record = { ...record, folderId: null };
    },
    async discard() {
      discarded = true;
      epoch += 1;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      const old = thread;
      thread = null;
      threadMode = null;
      if (running()) await old?.interrupt().catch(() => {});
      await old?.close().catch(() => {});
      setRunning(false);
      await writes.catch(() => {});
    },
  };
  return session;
}

/** Tools that need an open script. */
const SCRIPT_ONLY_TOOLS = new Set(["get_current_script", "propose_options", "report_fact_check"]);
