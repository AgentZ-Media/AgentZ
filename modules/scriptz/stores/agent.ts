import { createEffect, createRoot, createSignal, on, type Accessor } from "solid-js";
import { createStore, produce, reconcile, type SetStoreFunction } from "solid-js/store";
import { language } from "@agentz/kit/i18n";
import { registerFlusher } from "@agentz/kit/lib";
import { api } from "../lib/api";
import { finalStageId } from "../lib/stages";
import type { Folder } from "../lib/types";
import { CodexProvider, effortOrDefault, type CodexHostLike } from "../lib/agent/codex/provider";
import { latestChat, learnedHash, markLearned, saveChat, type ChatItem, type ChatRecord } from "../lib/agent/chats";
import { listMemory, selectRelevantMemory, deleteMemory, restoreMemory, updateMemory } from "../lib/agent/memory";
import { buildInstructions, contextBlock, LEARN_RULES, memoryBlock, personaBlock } from "../lib/agent/prompt";
import { blocksFromContent, charactersIn, hashBlocks } from "../lib/agent/scriptText";
import { createChatTools, createMemoryTools, stageNames, type MemoryChange, type ToolHost } from "../lib/agent/tools";
import type { AgentEvent, AgentModel, AgentProvider, AgentThread, ProviderState } from "../lib/agent/types";
import { agentSettings } from "./agentSettings";
import { agentUi } from "./agentUi";
import { scriptsBus } from "../lib/scriptsBus";
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

async function chatInstructions(scriptId: string | null): Promise<string> {
  const [all, folders] = await Promise.all([listMemory().catch(() => []), foldersMap()]);
  let title: string | null = null;
  let folderId: string | null = null;
  let characters: string[] = [];
  if (scriptId) {
    const script = await api.getScript(scriptId).catch(() => null);
    if (script) {
      title = script.title;
      folderId = script.folder_id;
      characters = charactersIn(liveBlocks(scriptId) ?? blocksFromContent(script.content_json));
    }
  }
  const relevant = selectRelevantMemory(all, folderId, characters);
  return buildInstructions(
    persona(),
    memoryBlock(relevant, folders),
    contextBlock({ scriptTitle: title, folder: folderId ? folders.get(folderId)?.name ?? null : null, characters, stages: stageNames() }),
    agentSettings.learnFromChat(),
  );
}

// ---------------------------------------------------------------------------
// Chat sessions (one per script, alive for the app session)
// ---------------------------------------------------------------------------

export interface ChatSession {
  readonly scriptId: string;
  items: ChatItem[];
  running: Accessor<boolean>;
  ready: Accessor<boolean>;
  send(text: string, quote?: { text: string; from: number; to: number }): Promise<void>;
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
}

const sessions = new Map<string, ChatSession>();
let nextLocalId = 1;
const localId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${nextLocalId++}`;

function createSession(scriptId: string): ChatSession {
  const [state, setState] = createStore<{ items: ChatItem[] }>({ items: [] });
  const [running, setRunning] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  let record: ChatRecord | null = null;
  let thread: AgentThread | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // Writes run one after another so an older snapshot never lands last.
  let writes: Promise<void> = Promise.resolve();
  let writeError: unknown = null;

  const loading = latestChat(scriptId).then((chat) => {
    record = chat;
    if (chat) setState("items", reconcile(chat.items));
  }).catch((error) => console.warn("[agent] loading chat failed", error)).finally(() => setReady(true));

  const write = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    const now = Date.now();
    if (!record) record = { id: crypto.randomUUID(), scriptId, provider: "codex", threadId: thread?.id ?? null, items: [], createdAt: now, updatedAt: now };
    record = { ...record, threadId: thread?.id ?? record.threadId, items: JSON.parse(JSON.stringify(state.items)) as ChatItem[], updatedAt: now };
    const snapshot = record;
    writes = writes.then(() => saveChat(snapshot)).then(
      () => { writeError = null; },
      (error: unknown) => { writeError = error; console.warn("[agent] saving chat failed", error); },
    );
  };

  const persist = (immediate = false) => {
    if (saveTimer) clearTimeout(saveTimer);
    if (immediate) write();
    else saveTimer = setTimeout(write, 400);
  };

  const push = (item: ChatItem) => setState("items", (items) => [...items, item]);
  const indexOf = (id: string) => state.items.findIndex((item) => item.id === id);

  const host: ToolHost = {
    scriptId,
    liveBlocks: () => liveBlocks(scriptId),
    selection: () => readSelection(scriptId),
    onProposal: (proposal) => push({ kind: "proposal", id: localId("proposal"), proposal, applied: null }),
    onClaims: (claims) => push({ kind: "claims", id: localId("claims"), claims, applied: [] }),
    onMemory: (change) => push(memoryItem(change)),
    memorySource: "chat",
    memorySourceScriptId: null,
  };

  const ensureThread = async (): Promise<AgentThread> => {
    if (thread) return thread;
    const p = getProvider();
    if (!p) throw new Error("agent unavailable");
    await loading;
    thread = await p.openThread({
      instructions: await chatInstructions(scriptId),
      tools: createChatTools(host),
      resumeId: record?.threadId ?? null,
    });
    return thread;
  };

  const session: ChatSession = {
    scriptId,
    get items() { return state.items; },
    running,
    ready,
    async send(text, quote) {
      const clean = text.trim();
      if (!clean || running()) return;
      setRunning(true);
      push({ kind: "user", id: localId("user"), text: clean, quote: quote?.text });
      persist();
      try {
        const list = await ensureModels();
        const model = resolveModel(list, agentSettings.model());
        const active = await ensureThread();
        const input = quote
          ? `Selected passage (blocks ${quote.from}-${quote.to} of the current script):\n"""${quote.text}"""\n\n${clean}`
          : clean;
        const result = await active.run(input, {
          model: model?.id ?? "",
          effort: effortOrDefault(model, agentSettings.effort()),
        }, (event) => applyEvent(setState, event));
        if (result.status === "interrupted") push({ kind: "interrupted", id: localId("int") });
        if (result.status === "failed") {
          push({ kind: "error", id: localId("err"), message: result.error ?? "" });
          // Resume the saved thread on the next message (e.g. after a crash).
          thread = null;
        }
      } catch (error) {
        push({ kind: "error", id: localId("err"), message: error instanceof Error ? error.message : String(error) });
        // A broken thread is re-opened on the next message.
        thread = null;
      } finally {
        finishStreaming(setState);
        setRunning(false);
        persist(true);
      }
    },
    async stop() {
      await thread?.interrupt();
    },
    async reset() {
      if (running()) await thread?.interrupt();
      await thread?.close().catch(() => {});
      thread = null;
      await loading;
      await writes;
      record = null;
      setState("items", []);
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
    },
    applyOption(itemId, index) {
      const i = indexOf(itemId);
      const item = state.items[i];
      if (!item || item.kind !== "proposal") return false;
      const option = item.proposal.options[index];
      const target = option ? applyBlocks(scriptId, option.blocks, item.proposal.target) : null;
      if (!option || !target) return false;
      revealBlock(scriptId, targetIndex(scriptId, target, option.blocks.length));
      setState("items", i, produce((draft) => { if (draft.kind === "proposal") draft.applied = index; }));
      persist(true);
      return true;
    },
    applyFix(itemId, index) {
      const i = indexOf(itemId);
      const item = state.items[i];
      if (!item || item.kind !== "claims") return false;
      const fix = item.claims[index]?.fix;
      const target = fix ? applyBlocks(scriptId, fix.blocks, fix.target) : null;
      if (!fix || !target) return false;
      revealBlock(scriptId, targetIndex(scriptId, target, fix.blocks.length));
      setState("items", i, produce((draft) => { if (draft.kind === "claims") draft.applied = [...draft.applied, index]; }));
      persist(true);
      return true;
    },
    append(items) {
      for (const item of items) push(item);
      persist();
    },
    async undoMemory(itemId) {
      const i = indexOf(itemId);
      const item = state.items[i];
      if (!item || item.kind !== "memory" || item.undone) return;
      await undoMemoryChange(item);
      setState("items", i, produce((draft) => { if (draft.kind === "memory") draft.undone = true; }));
      persist(true);
    },
  };
  return session;
}

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
const HIDDEN_TOOLS = new Set(["propose_options", "report_fact_check", "remember", "update_memory", "forget_memory"]);

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
//  - after a script reaches the last stage (background, sequential)
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
    const finished = (await api.listScripts({ status: finalStageId(), sort: "updated", limit: 500 }))
      .filter((s) => Math.max(s.status_changed_at ?? 0, s.updated_at) > since);
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
    const final = finalStageId();
    // Finished scripts first: they show the writer's intended result.
    summaries.sort((a, b) => Number(b.status === final) - Number(a.status === final));
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
  const live = sessions.get(scriptId);
  if (live) {
    live.append(items);
    return;
  }
  const chat = await latestChat(scriptId);
  const now = Date.now();
  await saveChat(chat
    ? { ...chat, items: [...chat.items, ...items], updatedAt: now }
    : { id: crypto.randomUUID(), scriptId, provider: "codex", threadId: null, items, createdAt: now, updatedAt: now });
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export const agentStore = {
  status,
  models,
  modelsLoading,
  learning,
  available: () => codexHost !== null,
  refreshStatus,
  refreshModels,
  resolveModel: () => resolveModel(models(), agentSettings.model()),
  session(scriptId: string): ChatSession {
    let session = sessions.get(scriptId);
    if (!session) {
      session = createSession(scriptId);
      sessions.set(scriptId, session);
    }
    return session;
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
  for (const session of sessions.values()) session.release();
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
    createEffect(on(() => agentSettings.enabled() && agentSettings.onboarded() && agentSettings.learnFromScripts(), (on) => {
      if (on) scheduleLearning(3000);
    }));
    createEffect(on(agentSettings.enabled, (enabled) => {
      if (!enabled) shutdownProvider();
    }, { defer: true }));
    // Onboarding checks Codex before the agent is on; cancelling it must not
    // leave the process running.
    createEffect(on(agentUi.onboardingOpen, (open) => {
      if (!open && !agentSettings.enabled() && provider) shutdownProvider();
    }, { defer: true }));
    return dispose;
  });
  // Closing and quitting wait for chat writes (applied options, undos).
  const offFlush = registerFlusher(
    () => Promise.all([...sessions.values()].map((session) => session.flush())).then(() => undefined),
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
    for (const session of sessions.values()) {
      session.release();
      void session.flush().catch(() => {});
    }
    sessions.clear();
    const p = provider;
    provider = null;
    codexHost = null;
    statusCheck = null;
    setStatus({ state: "checking" });
    setModels([]);
    if (p) void p.dispose();
  };
}
