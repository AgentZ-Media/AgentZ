import { createEffect, createRoot, createSignal, on, type Accessor } from "solid-js";
import { createStore, produce, reconcile, type SetStoreFunction } from "solid-js/store";
import { language } from "@agentz/kit/i18n";
import { registerFlusher } from "@agentz/kit/lib";
import { t } from "../i18n";
import { api } from "../lib/api";
import { scriptStages } from "../lib/stages";
import type { Folder } from "../lib/types";
import { CodexProvider, effortOrDefault, type CodexHostLike } from "../lib/agent/codex/provider";
import { learnStageIds } from "../lib/agent/learnStage";
import { draftStates, getChat, latestChat, learnedHash, listSessions, markLearned, saveChat, deleteChat, type ChatItem, type ChatKind, type ChatRecord, type SavedIdeaRef, type SessionSummary } from "../lib/agent/chats";
import { listMemory, selectRelevantMemory, deleteMemory, restoreMemory, updateMemory } from "../lib/agent/memory";
import { buildInstructions, contextBlock, LEARN_RULES, memoryBlock, personaBlock, type InstructionMode } from "../lib/agent/prompt";
import { blocksFromContent, charactersIn, hashBlocks } from "../lib/agent/scriptText";
import { createChatTools, createMemoryTools, stageNames, type MemoryChange, type ToolHost } from "../lib/agent/tools";
import type { AgentEvent, AgentModel, AgentProvider, AgentThread, AgentTool, ProviderState } from "../lib/agent/types";
import { createSessionTools, existingFolder, ideaNotes, type IdeaBoardRef, type SessionToolHost } from "../lib/agent/sessionTools";
import { describeTarget, writingTarget, type Pace } from "../lib/agent/writingContext";
import { settingsStore } from "./settings";
import { agentSettings } from "./agentSettings";
import { agentUi } from "./agentUi";
import { scriptsBus } from "../lib/scriptsBus";
import { foldersBus } from "../lib/foldersBus";
import { applyBlocks, liveBlocks, readSelection, revealBlock, targetIndex } from "../components/Agent/editorBridge";

// ---------------------------------------------------------------------------
// Provider + status
// ---------------------------------------------------------------------------

let codexHost: CodexHostLike | null = null;
let provider: AgentProvider | null = null;

export type AgentStatus = ProviderState | { state: "checking" } | { state: "unavailable" };
const [status, setStatus] = createSignal<AgentStatus>({ state: "checking" });
const [models, setModels] = createSignal<AgentModel[]>([]);
const [modelsLoading, setModelsLoading] = createSignal(false);
const [learning, setLearning] = createSignal<{ title: string } | null>(null);

function isCodexHost(value: unknown): value is CodexHostLike {
  const v = value as Partial<CodexHostLike> | null;
  return !!v && typeof v.locate === "function" && typeof v.start === "function";
}

function getProvider(): AgentProvider | null {
  if (provider) return provider;
  if (!codexHost) return null;
  provider = new CodexProvider(codexHost);
  return provider;
}

let statusCheck: Promise<AgentStatus> | null = null;

/** One check at a time. Never re-sets "checking" while checking, so effects
 *  that react to the status cannot loop. */
function refreshStatus(): Promise<AgentStatus> {
  if (statusCheck) return statusCheck;
  const p = getProvider();
  if (!p) {
    setStatus({ state: "unavailable" });
    return Promise.resolve(status());
  }
  if (status().state !== "checking") setStatus({ state: "checking" });
  const run = p.check()
    .catch((error: unknown): AgentStatus => ({ state: "error", message: error instanceof Error ? error.message : String(error) }))
    .then((next) => {
      // A check that outlived its provider (agent switched off) is stale.
      if (provider === p) setStatus(next);
      return next;
    })
    .finally(() => { if (statusCheck === run) statusCheck = null; });
  statusCheck = run;
  return run;
}

async function refreshModels(): Promise<AgentModel[]> {
  const p = getProvider();
  if (!p) return [];
  setModelsLoading(true);
  try {
    const list = await p.listModels();
    setModels(list);
    return list;
  } finally {
    setModelsLoading(false);
  }
}

async function ensureModels(): Promise<AgentModel[]> {
  return models().length ? models() : refreshModels().catch(() => []);
}

/** The chosen model, else the provider's default, else the first. */
function resolveModel(list: readonly AgentModel[], chosen: string): AgentModel | undefined {
  return list.find((m) => m.id === chosen) ?? list.find((m) => m.isDefault) ?? list[0];
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

function persona() {
  return {
    name: agentSettings.displayName(),
    userName: agentSettings.userName(),
    traits: agentSettings.traits(),
    instructions: agentSettings.instructions(),
    language: language(),
  };
}

async function foldersMap(): Promise<Map<string, Folder>> {
  const list = await api.listFolders().catch(() => [] as Folder[]);
  return new Map(list.map((f) => [f.id, f]));
}

/** Speaking pace and default length target from the product settings. */
export function currentPace(): Pace {
  return {
    wpm: settingsStore.dialogWpm(),
    defaults: { minSec: settingsStore.lengthMinDefaultSec(), maxSec: settingsStore.lengthMaxDefaultSec() },
  };
}

async function chatInstructions(scriptId: string | null, mode: InstructionMode, sessionFolderId: string | null): Promise<string> {
  const [all, folders] = await Promise.all([listMemory().catch(() => []), foldersMap()]);
  let title: string | null = null;
  let folderId: string | null = scriptId ? null : sessionFolderId;
  let characters: string[] = [];
  if (scriptId) {
    const script = await api.getScript(scriptId).catch(() => null);
    if (script) {
      title = script.title;
      folderId = script.folder_id;
      characters = charactersIn(liveBlocks(scriptId) ?? blocksFromContent(script.content_json));
    }
  }
  const folder = folderId ? folders.get(folderId) ?? null : null;
  const relevant = selectRelevantMemory(all, folderId, characters);
  return buildInstructions(
    persona(),
    memoryBlock(relevant, folders),
    contextBlock({
      scriptTitle: title,
      folder: folder?.name ?? null,
      characters,
      stages: stageNames(),
      // Sessions get the target with every message (the folder can change).
      target: scriptId ? describeTarget(writingTarget(folder, currentPace())) : undefined,
    }),
    agentSettings.learnFromChat(),
    mode,
  );
}

// ---------------------------------------------------------------------------
// Chats: one per script (panel) or per session (agent mode). A session can
// be handed to a script it created; it is then the script's chat as well
// and the same live object serves both views.
// ---------------------------------------------------------------------------

export interface ChatSession {
  /** Id of the chat row (stable until "New chat" in a script panel). */
  chatId(): string;
  kind(): ChatKind;
  /** The script the chat belongs to; null for a session not handed over. */
  scriptId(): string | null;
  title(): string | null;
  folderId(): string | null;
  setFolder(folderId: string | null): void;
  items: ChatItem[];
  running: Accessor<boolean>;
  ready: Accessor<boolean>;
  /** `options.instruction` goes to the model instead of `text`; the chat
   *  shows `text` (a job's short label). `options.hint` is context for the
   *  model only (e.g. an idea id), never shown. */
  send(text: string, quote?: ChatQuote, options?: SendOptions): Promise<void>;
  stop(): Promise<void>;
  /** "New chat": ends the thread and stores an empty chat, so the old
   *  conversation does not come back after a restart. */
  reset(): Promise<void>;
  /** Writes a pending save now; rejects if the last write failed. */
  flush(): Promise<void>;
  /** Drops the provider thread but keeps the visible chat; the next message
   *  resumes the saved thread on a fresh connection. */
  release(): void;
  applyOption(itemId: string, index: number): boolean;
  applyFix(itemId: string, index: number): boolean;
  undoMemory(itemId: string): Promise<void>;
  /** Adds items from outside a turn (e.g. background learning). */
  append(items: ChatItem[]): void;
  /** Picks or unpicks an idea card. */
  togglePick(itemId: string, index: number): void;
  /** Saves idea cards of a board to the idea list (button, not the model). */
  saveIdeas(itemId: string, indices: number[]): Promise<number>;
  undoSavedIdeas(itemId: string): Promise<void>;
  discardDraft(slug: string, versionId: string): void;
  /** Records that a draft version became a script. */
  recordHandoff(entry: Omit<Extract<ChatItem, { kind: "handoff" }>, "kind" | "id" | "at">): void;
  /** Moves the chat to a script (it becomes that script's chat) and takes
   *  over the script's folder. */
  attachToScript(scriptId: string, folderId: string | null): Promise<void>;
  /** The script was deleted for good: a session goes on without it. */
  detachFromScript(): void;
  /** The session's folder was deleted. */
  forgetFolder(): void;
  /** Stops for good before the chat row is deleted: no turn, timer or
   *  pending write may store it again. */
  discard(): Promise<void>;
}

export interface SendOptions {
  /** Sent to the model instead of the visible text (fixed jobs). */
  instruction?: string;
  /** Job id stored on the user item (lib/agent/jobs.ts). */
  job?: string;
  /** Context for the model only, never shown. */
  hint?: string;
}

export interface ChatQuote {
  text: string;
  /** Block range in the open script; absent for a quote from a draft. */
  from?: number;
  to?: number;
  /** Draft the quote comes from. */
  draft?: string;
}

/** Live chats by script (panel) and by chat id (agent mode). */
const byScript = new Map<string, ChatSession>();
const byChat = new Map<string, ChatSession>();
/** Bumped when a chat joins or leaves the maps: views that ask "is any
 *  chat running?" must also see chats created after they first looked. */
const [chatsVersion, setChatsVersion] = createSignal(0);
const chatsChanged = () => setChatsVersion((v) => v + 1);
let nextLocalId = 1;
const localId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${nextLocalId++}`;

/** Bumped after a session row was written; the session list follows. */
const [sessionsVersion, setSessionsVersion] = createSignal(0);
let sessionsBump: ReturnType<typeof setTimeout> | null = null;
function bumpSessions(delayMs = 300): void {
  if (sessionsBump) clearTimeout(sessionsBump);
  sessionsBump = setTimeout(() => { sessionsBump = null; setSessionsVersion((v) => v + 1); }, delayMs);
}

const SESSION_TITLE_MAX = 80;

export function sessionTitleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > SESSION_TITLE_MAX ? `${line.slice(0, SESSION_TITLE_MAX - 1).trimEnd()}…` : line;
}

type ChatSource =
  /** `record`: the script's newest chat, already loaded (or none yet). */
  | { kind: "script"; scriptId: string; record: ChatRecord | null }
  | { kind: "session"; chatId: string; folderId?: string | null };

function createChat(source: ChatSource): ChatSession {
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

  /** Context line in front of a session message: folder, target, pace,
   *  drafts and saved ideas, so the model always works with what the user
   *  sees right now. */
  const sessionPreamble = async (): Promise<string> => {
    const folders = await foldersMap();
    const folder = folderId() ? folders.get(folderId()!) ?? null : null;
    const parts = [describeTarget(writingTarget(folder, currentPace()))];
    const drafts = draftStates(state.items);
    if (drafts.length) {
      parts.push(`Drafts in this session: ${drafts.map(({ draft, latest, state: s }) =>
        `"${latest.title || draft.slug}" (id ${draft.slug}, version ${draft.versions.length}${s === "finished" ? ", already turned into a script" : s === "discarded" ? ", discarded" : ""})`).join("; ")}.`);
    }
    const saved: string[] = [];
    for (const item of state.items) {
      if (item.kind !== "ideas-saved" || item.undone) continue;
      for (const ref of item.saved) saved.push(`"${ref.title}" (idea id ${ref.ideaId})`);
    }
    if (saved.length) parts.push(`Ideas saved in this session: ${saved.slice(-12).join("; ")}.`);
    return `[Session: ${parts.join(" ")}]`;
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
        if (modeNow() === "session") input = `${await sessionPreamble()}\n\n${input}`;
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

function memoryItem(change: MemoryChange): ChatItem {
  return change.action === "updated"
    ? { kind: "memory", id: localId("mem"), action: "updated", entry: change.entry, previous: change.previous }
    : { kind: "memory", id: localId("mem"), action: change.action, entry: change.entry };
}

async function undoMemoryChange(item: Extract<ChatItem, { kind: "memory" }>): Promise<void> {
  if (item.action === "added") await deleteMemory(item.entry.id);
  else if (item.action === "removed") await restoreMemory(item.entry);
  else if (item.previous) await updateMemory(item.previous.id, item.previous.content).catch(() => restoreMemory(item.previous!));
}

/** Maps one provider event onto the chat items (streaming in place). */
function applyEvent(setState: SetStoreFunction<{ items: ChatItem[] }>, event: AgentEvent): void {
  const find = (items: ChatItem[], id: string) => items.findIndex((item) => item.id === id);
  setState("items", produce((items) => {
    switch (event.type) {
      case "message-delta": {
        const i = find(items, event.itemId);
        if (i >= 0 && items[i].kind === "assistant") (items[i] as Extract<ChatItem, { kind: "assistant" }>).text += event.delta;
        else items.push({ kind: "assistant", id: event.itemId, text: event.delta, streaming: true, commentary: event.commentary });
        return;
      }
      case "message": {
        const i = find(items, event.itemId);
        if (!event.text.trim()) { if (i >= 0) items.splice(i, 1); return; }
        if (i >= 0 && items[i].kind === "assistant") Object.assign(items[i], { text: event.text, streaming: false, commentary: event.commentary });
        else items.push({ kind: "assistant", id: event.itemId, text: event.text, commentary: event.commentary });
        return;
      }
      case "reasoning-delta": {
        const i = find(items, event.itemId);
        if (i >= 0 && items[i].kind === "thinking") (items[i] as Extract<ChatItem, { kind: "thinking" }>).text += event.delta;
        else items.push({ kind: "thinking", id: event.itemId, text: event.delta, done: false });
        return;
      }
      case "reasoning": {
        const i = find(items, event.itemId);
        if (!event.text.trim()) { if (i >= 0) items.splice(i, 1); return; }
        if (i >= 0 && items[i].kind === "thinking") Object.assign(items[i], { text: event.text, done: true });
        else items.push({ kind: "thinking", id: event.itemId, text: event.text, done: true });
        return;
      }
      case "tool-start": {
        if (HIDDEN_TOOLS.has(event.tool)) return;
        if (find(items, event.itemId) >= 0) return;
        items.push({ kind: "tool", id: event.itemId, tool: event.tool, args: argsOf(event.args), status: "running" });
        return;
      }
      case "tool-end": {
        if (HIDDEN_TOOLS.has(event.tool)) return;
        const i = find(items, event.itemId);
        const status = event.ok ? "done" as const : "failed" as const;
        if (i >= 0 && items[i].kind === "tool") Object.assign(items[i], { status, args: argsOf(event.args) });
        else items.push({ kind: "tool", id: event.itemId, tool: event.tool, args: argsOf(event.args), status });
        return;
      }
      case "web-search": {
        const i = find(items, event.itemId);
        const status = event.status === "done" ? "done" as const : "running" as const;
        if (i >= 0 && items[i].kind === "search") Object.assign(items[i], { status, query: event.query || (items[i] as Extract<ChatItem, { kind: "search" }>).query });
        else items.push({ kind: "search", id: event.itemId, query: event.query, status });
        return;
      }
      case "blocked":
        items.push({ kind: "blocked", id: event.itemId, what: event.what });
        return;
      case "error":
        items.push({ kind: "error", id: `err-${items.length}`, message: event.message });
        return;
    }
  }));
}

/** Tools whose result is shown as its own card (or not at all). */
const HIDDEN_TOOLS = new Set(["propose_options", "report_fact_check", "remember", "update_memory", "forget_memory", "propose_ideas", "save_ideas", "suggest_replies"]);

function argsOf(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try { return argsOf(JSON.parse(raw)); } catch { return {}; }
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function finishStreaming(setState: SetStoreFunction<{ items: ChatItem[] }>): void {
  setState("items", produce((items) => {
    for (const item of items) {
      if (item.kind === "assistant" && item.streaming) item.streaming = false;
      if (item.kind === "thinking" && !item.done) item.done = true;
      if ((item.kind === "tool" || item.kind === "search") && item.status === "running") item.status = "done";
    }
  }));
}

// ---------------------------------------------------------------------------
// Learning (always optional for the agent; it may store nothing)
//  - after a script reaches the learn stage, by default the last one
//    (background, sequential)
//  - once over all existing scripts (onboarding / settings, with progress)
// ---------------------------------------------------------------------------

let learnTimer: ReturnType<typeof setTimeout> | null = null;
let learnRunning = false;
let learnGeneration = 0;
const learnFailures = new Map<string, number>();
let activeLearnThread: AgentThread | null = null;

interface LearnTarget {
  id: string;
  title: string;
  folderId: string | null;
  hash: string;
}

export interface BootstrapState {
  running: boolean;
  total: number;
  done: number;
  current: string[];
  /** Newest first, a few recent memory changes for the progress view. */
  recent: MemoryChange[];
  finished: boolean;
}
const IDLE_BOOTSTRAP: BootstrapState = { running: false, total: 0, done: 0, current: [], recent: [], finished: false };
const [bootstrap, setBootstrap] = createSignal<BootstrapState>(IDLE_BOOTSTRAP);
let bootstrapGeneration = 0;
const BATCH_SIZE = 4;
/** Quiet time after the last edit before a finished script is learned. */
const SETTLE_MS = 90_000;

/** Stages whose scripts count as finished for learning: the configured
 *  learn stage and every later one. */
function finishedStageIds(): string[] {
  return learnStageIds(agentSettings.learnStage(), scriptStages());
}

function scheduleLearning(delayMs = 6000): void {
  if (learnTimer) clearTimeout(learnTimer);
  learnTimer = setTimeout(() => { learnTimer = null; void runLearning(); }, delayMs);
}

async function learnTargetFor(id: string): Promise<LearnTarget | null> {
  const script = await api.getScript(id).catch(() => null);
  if (!script) return null;
  const blocks = blocksFromContent(script.content_json);
  if (blocks.length < 3) return null;
  const hash = hashBlocks(blocks);
  if ((await learnedHash(script.id)) === hash) return null;
  return { id: script.id, title: script.title, folderId: script.folder_id, hash };
}

async function runLearning(): Promise<void> {
  if (learnRunning || bootstrap().running) return;
  if (!agentSettings.enabled() || !agentSettings.onboarded() || !agentSettings.learnFromScripts()) return;
  if (status().state !== "ready") return;
  // Only scripts finished after the agent was set up; older ones are
  // learned only through the explicit retroactive action.
  const since = agentSettings.learnSince();
  if (since <= 0) return;
  learnRunning = true;
  const generation = learnGeneration;
  try {
    const now = Date.now();
    const lists = await Promise.all(finishedStageIds().map((status) => api.listScripts({ status, sort: "updated", limit: 500 })));
    const finished = lists.flat()
      .filter((s) => Math.max(s.status_changed_at ?? 0, s.updated_at) > since)
      .sort((a, b) => b.updated_at - a.updated_at);
    // A finished script that is still being edited is learned once it has
    // been quiet for a while, not after every keystroke.
    const settling = finished.filter((s) => s.updated_at > now - SETTLE_MS);
    if (settling.length) scheduleLearning(SETTLE_MS + 5000);
    for (const summary of finished) {
      if (summary.updated_at > now - SETTLE_MS) continue;
      if (generation !== learnGeneration || bootstrap().running || !agentSettings.enabled() || !agentSettings.learnFromScripts()) break;
      if ((learnFailures.get(summary.id) ?? 0) >= 2) continue;
      const target = await learnTargetFor(summary.id);
      if (!target) continue;
      setLearning({ title: target.title });
      try {
        const changes = await learnBatch([target], "finished");
        await markLearned(target.id, target.hash);
        if (changes.length) await appendLearnedToChat(target.id, changes);
      } catch (error) {
        if (error instanceof LearnInterrupted) break;
        learnFailures.set(target.id, (learnFailures.get(target.id) ?? 0) + 1);
        console.warn("[agent] learning failed", target.id, error);
      }
    }
  } catch (error) {
    console.warn("[agent] learning run failed", error);
  } finally {
    setLearning(null);
    learnRunning = false;
  }
}

/** A learning turn that did not finish (cancelled, agent switched off,
 *  timeout). Not a failure, but nothing may be marked as learned. */
class LearnInterrupted extends Error {
  constructor() {
    super("learning interrupted");
  }
}

/** One learning turn over one or more scripts. Returns what changed; throws
 *  unless the turn completed, so callers only mark finished work. */
async function learnBatch(targets: LearnTarget[], kind: "finished" | "existing", onChange?: (change: MemoryChange) => void): Promise<MemoryChange[]> {
  if (targets.length === 0) return [];
  const p = getProvider();
  if (!p) throw new LearnInterrupted();
  const [all, folders, list] = await Promise.all([listMemory(), foldersMap(), ensureModels()]);
  // Switched off (or onboarding closed) while loading: do not start Codex again.
  if (provider !== p) throw new LearnInterrupted();
  const changes: MemoryChange[] = [];
  const sourceId = targets.length === 1 ? targets[0].id : null;
  const record = (change: MemoryChange) => { changes.push(change); onChange?.(change); };
  const tools = [
    ...createChatTools({
      scriptId: sourceId, liveBlocks: () => (sourceId ? liveBlocks(sourceId) : null), selection: () => null,
      onProposal: () => {}, onClaims: () => {}, onMemory: record,
      memorySource: "script", memorySourceScriptId: sourceId,
    }).filter((tool) => ["read_script", "list_scripts", "search_scripts", "list_folders"].includes(tool.name)),
    ...createMemoryTools({ scriptId: sourceId, onMemory: record, memorySource: "script", memorySourceScriptId: sourceId }),
  ];
  const instructions = [personaBlock(persona()), LEARN_RULES, `Your memory:\n${memoryBlock(all, folders)}`].join("\n\n---\n\n");
  const thread = await p.openThread({ instructions, tools, ephemeral: true });
  activeLearnThread = thread;
  try {
    const model = resolveModel(list, agentSettings.learnModel() || agentSettings.model());
    const lines = targets.map((target) => {
      const folder = target.folderId ? folders.get(target.folderId)?.name ?? null : null;
      return `- "${target.title}" (id ${target.id})${folder ? ` in folder "${folder}"` : " (no folder)"}`;
    });
    const intro = kind === "finished"
      ? "This script was just finished:"
      : "These are existing scripts the user wrote before you were set up. Look at them once to get to know the characters, folders and style:";
    const result = await thread.run(`${intro}\n${lines.join("\n")}`, {
      model: model?.id ?? "",
      effort: effortOrDefault(model, agentSettings.learnEffort()),
    }, () => {});
    if (result.status === "failed") throw new Error(result.error ?? "learning turn failed");
    if (result.status !== "completed") throw new LearnInterrupted();
  } finally {
    if (activeLearnThread === thread) activeLearnThread = null;
    await thread.close().catch(() => {});
  }
  return changes;
}

/** Scripts that could be learned retroactively (not yet learned in this state). */
async function existingScriptCount(): Promise<number> {
  const list = await api.listScripts({ sort: "updated", limit: 2000 }).catch(() => []);
  return list.filter((s) => Math.max(0, s.word_count) >= 15).length;
}

async function startBootstrap(): Promise<void> {
  if (bootstrap().running) return;
  const generation = ++bootstrapGeneration;
  setBootstrap({ ...IDLE_BOOTSTRAP, running: true });
  try {
    if (status().state !== "ready") await refreshStatus();
    if (status().state !== "ready") throw new Error("agent not ready");
    const summaries = await api.listScripts({ sort: "updated", limit: 2000 });
    const finished = new Set(finishedStageIds());
    // Finished scripts first: they show the writer's intended result.
    summaries.sort((a, b) => Number(finished.has(b.status)) - Number(finished.has(a.status)));
    const targets: LearnTarget[] = [];
    for (const summary of summaries) {
      if (generation !== bootstrapGeneration) return;
      const target = await learnTargetFor(summary.id);
      if (target) targets.push(target);
    }
    setBootstrap((s) => ({ ...s, total: targets.length }));
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      if (generation !== bootstrapGeneration) return;
      const batch = targets.slice(i, i + BATCH_SIZE);
      setBootstrap((s) => ({ ...s, current: batch.map((b) => b.title) }));
      try {
        await learnBatch(batch, "existing", (change) => setBootstrap((s) => ({ ...s, recent: [change, ...s.recent].slice(0, 6) })));
        for (const target of batch) await markLearned(target.id, target.hash);
      } catch (error) {
        // Outer handler resets the progress state (timeout, agent off).
        if (error instanceof LearnInterrupted) throw error;
        console.warn("[agent] retroactive learning batch failed", error);
      }
      if (generation !== bootstrapGeneration) return;
      setBootstrap((s) => ({ ...s, done: Math.min(s.total, s.done + batch.length) }));
    }
    setBootstrap((s) => ({ ...s, running: false, current: [], finished: true }));
  } catch (error) {
    console.warn("[agent] retroactive learning failed", error);
    if (generation === bootstrapGeneration) setBootstrap((s) => ({ ...s, running: false, current: [] }));
  }
}

function cancelBootstrap(): void {
  bootstrapGeneration += 1;
  void activeLearnThread?.interrupt();
  setBootstrap((s) => ({ ...s, running: false, current: [] }));
}

/** Shows what was learned in that script's chat, each entry with undo. */
async function appendLearnedToChat(scriptId: string, changes: MemoryChange[]): Promise<void> {
  const items = changes.map(memoryItem);
  // The script's newest chat may be live under its chat id only (a session
  // opened in the agent mode): append through that object, never around it.
  const chat = await latestChat(scriptId);
  const live = (chat ? liveChats().find((entry) => entry.chatId() === chat.id) : undefined) ?? (chat ? undefined : byScript.get(scriptId));
  if (live) {
    live.append(items);
    return;
  }
  const now = Date.now();
  await saveChat(chat
    ? { ...chat, items: [...chat.items, ...items], updatedAt: now }
    : { id: crypto.randomUUID(), kind: "script", scriptId, provider: "codex", threadId: null, title: null, folderId: null, items, createdAt: now, updatedAt: now });
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const pendingScripts = new Map<string, Promise<ChatSession>>();

/** Live chats whose script or folder was deleted for good follow along:
 *  a session goes on without them, a script chat is gone with its row. */
async function reconcileLiveChats(): Promise<void> {
  const chats = liveChats();
  if (chats.length === 0) return;
  // null = the read failed: then nothing is changed (an empty list is a
  // real answer, e.g. the last folder was deleted).
  const list = await api.listFolders().catch(() => null);
  const folders = list ? new Set(list.map((f) => f.id)) : null;
  for (const chat of chats) {
    const folder = chat.folderId();
    if (folder && folders && !folders.has(folder)) chat.forgetFolder();
    const script = chat.scriptId();
    if (!script) continue;
    // Only a definite "not found" counts; a failed read changes nothing.
    const gone = await api.getScript(script).then(
      () => false,
      (error: unknown) => error instanceof Error && error.message.startsWith("not found"),
    );
    if (!gone) continue;
    if (chat.kind() === "session") {
      chat.detachFromScript();
    } else {
      await chat.discard();
      for (const [key, value] of byScript) if (value === chat) byScript.delete(key);
      for (const [key, value] of byChat) if (value === chat) byChat.delete(key);
      chatsChanged();
    }
  }
}

function liveChats(): ChatSession[] {
  chatsVersion();
  return [...new Set([...byScript.values(), ...byChat.values()])];
}

const [sessionList, setSessionList] = createSignal<SessionSummary[]>([]);
const [sessionListReady, setSessionListReady] = createSignal(false);
let sessionListGeneration = 0;

async function refreshSessionList(): Promise<void> {
  const generation = ++sessionListGeneration;
  try {
    const list = await listSessions(40);
    if (generation === sessionListGeneration) setSessionList(list);
  } catch (error) {
    console.warn("[agent] listing sessions failed", error);
  } finally {
    if (generation === sessionListGeneration) setSessionListReady(true);
  }
}

export const agentStore = {
  status,
  models,
  modelsLoading,
  learning,
  available: () => codexHost !== null,
  refreshStatus,
  refreshModels,
  resolveModel: () => resolveModel(models(), agentSettings.model()),
  /** The live chat of a script, if one is loaded. */
  liveSession(scriptId: string): ChatSession | null {
    return byScript.get(scriptId) ?? null;
  },
  /** The chat of a script (panel). Resolves the script's newest chat row
   *  first, so a session already open in the agent mode is the very same
   *  object (two objects would overwrite each other's messages). */
  sessionFor(scriptId: string): Promise<ChatSession> {
    const live = byScript.get(scriptId);
    if (live) return Promise.resolve(live);
    let pending = pendingScripts.get(scriptId);
    if (!pending) {
      pending = (async () => {
        const record = await latestChat(scriptId).catch((error: unknown) => {
          console.warn("[agent] loading chat failed", error);
          return null;
        });
        const again = byScript.get(scriptId);
        if (again) return again;
        const session = (record ? byChat.get(record.id) : undefined) ?? createChat({ kind: "script", scriptId, record });
        byScript.set(scriptId, session);
        if (record && !byChat.has(record.id)) byChat.set(record.id, session);
        chatsChanged();
        return session;
      })().finally(() => pendingScripts.delete(scriptId));
      pendingScripts.set(scriptId, pending);
    }
    return pending;
  },
  /** A chat by id (agent mode). Unknown ids start a new, unsaved session. */
  chat(chatId: string, options: { folderId?: string | null } = {}): ChatSession {
    let session = byChat.get(chatId) ?? liveChats().find((chat) => chat.chatId() === chatId);
    if (!session) {
      session = createChat({ kind: "session", chatId, folderId: options.folderId });
      byChat.set(chatId, session);
      chatsChanged();
    }
    return session;
  },
  /** Sessions for the start screen and the session menu, newest first. */
  sessions: sessionList,
  sessionsReady: sessionListReady,
  refreshSessions: refreshSessionList,
  /** Open drafts over all recent sessions (sidebar badge). */
  openDrafts: () => sessionList().reduce((sum, s) => sum + s.openDrafts, 0),
  /** A chat of this id is answering right now. */
  isRunning: (chatId: string) => liveChats().some((chat) => chat.chatId() === chatId && chat.running()),
  anyRunning: () => liveChats().some((chat) => chat.running()),
  async deleteSession(chatId: string): Promise<void> {
    const live = liveChats().find((chat) => chat.chatId() === chatId);
    if (live) {
      // Ends the turn and drains writes; a late completion cannot store
      // the row again after it is deleted.
      await live.discard();
      for (const [key, chat] of byChat) if (chat === live) byChat.delete(key);
      for (const [key, chat] of byScript) if (chat === live) byScript.delete(key);
      chatsChanged();
    }
    await deleteChat(chatId);
    await refreshSessionList();
  },
  scheduleLearning,
  bootstrap,
  startBootstrap,
  cancelBootstrap,
  existingScriptCount,
};

/** Ends the Codex process and all turns; chats stay visible. Used when the
 *  agent is switched off. The status check after switching back on starts a
 *  fresh provider. */
function shutdownProvider(): void {
  learnGeneration += 1;
  cancelBootstrap();
  if (learnTimer) clearTimeout(learnTimer);
  learnTimer = null;
  setLearning(null);
  for (const session of liveChats()) session.release();
  const p = provider;
  provider = null;
  statusCheck = null;
  setStatus({ state: "checking" });
  setModels([]);
  if (p) void p.dispose();
}

export function startAgentRuntime(services: Readonly<Record<string, unknown>>): () => void {
  codexHost = isCodexHost(services.codexHost) ? services.codexHost : null;
  // Any script change (stage, content, import) may finish a script.
  const disposeWatch = createRoot((dispose) => {
    createEffect(on(scriptsBus.version, () => scheduleLearning(), { defer: true }));
    // Switching learning on or moving the learn stage may make scripts due.
    createEffect(on(() => (agentSettings.enabled() && agentSettings.onboarded() && agentSettings.learnFromScripts()
      ? finishedStageIds().join(",")
      : ""), (key) => {
      if (key) scheduleLearning(3000);
    }));
    createEffect(on(agentSettings.enabled, (enabled) => {
      if (!enabled) shutdownProvider();
    }, { defer: true }));
    // Onboarding checks Codex before the agent is on; cancelling it must not
    // leave the process running.
    createEffect(on(agentUi.onboardingOpen, (open) => {
      if (!open && !agentSettings.enabled() && provider) shutdownProvider();
    }, { defer: true }));
    // The session list follows every session write (and ideas/scripts that
    // a finished draft touched).
    // Only where the agent exists at all (no queries in builds without it).
    createEffect(on(sessionsVersion, () => { if (codexHost) void refreshSessionList(); }));
    createEffect(on([scriptsBus.version, foldersBus.version], () => {
      if (codexHost) void reconcileLiveChats().catch((error) => console.warn("[agent] reconciling chats failed", error));
    }, { defer: true }));
    return dispose;
  });
  // Closing and quitting wait for chat writes (applied options, undos).
  const offFlush = registerFlusher(
    () => Promise.all(liveChats().map((session) => session.flush())).then(() => undefined),
    "agent-chats",
    "state",
  );
  return () => {
    offFlush();
    disposeWatch();
    learnGeneration += 1;
    cancelBootstrap();
    setBootstrap(IDLE_BOOTSTRAP);
    if (learnTimer) clearTimeout(learnTimer);
    learnTimer = null;
    // Keep the chats: teardown is not "New chat". Disposing the provider below
    // ends running turns; pending writes still go out.
    for (const session of liveChats()) {
      session.release();
      void session.flush().catch(() => {});
    }
    byScript.clear();
    byChat.clear();
    pendingScripts.clear();
    chatsChanged();
    sessionListGeneration += 1;
    setSessionList([]);
    setSessionListReady(false);
    if (sessionsBump) clearTimeout(sessionsBump);
    sessionsBump = null;
    const p = provider;
    provider = null;
    codexHost = null;
    statusCheck = null;
    setStatus({ state: "checking" });
    setModels([]);
    if (p) void p.dispose();
  };
}
