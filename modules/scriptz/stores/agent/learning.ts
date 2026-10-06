import { createSignal } from "solid-js";
import { api } from "../../lib/api";
import { scriptStages } from "../../lib/stages";
import { effortOrDefault } from "../../lib/agent/codex/provider";
import { learnStageIds } from "../../lib/agent/learnStage";
import { latestChat, learnedHash, markLearned, saveChat } from "../../lib/agent/chats";
import { listMemory } from "../../lib/agent/memory";
import { LEARN_RULES, memoryBlock, personaBlock } from "../../lib/agent/prompt";
import { blocksFromContent, hashBlocks } from "../../lib/agent/scriptText";
import { createChatTools, createMemoryTools, type MemoryChange } from "../../lib/agent/tools";
import type { AgentThread } from "../../lib/agent/types";
import { agentSettings } from "../agentSettings";
import { liveBlocks } from "../../components/Agent/editorBridge";
import { currentProvider, ensureModels, getProvider, refreshStatus, resolveModel, status } from "./provider";
import { foldersMap, persona } from "./instructions";
import { memoryItem } from "./chatItems";
import { byScript, liveChats } from "./registry";

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
/** The script being learned in the background (sidebar indicator). */
const [learning, setLearning] = createSignal<{ title: string } | null>(null);
export { learning };

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
export { bootstrap };
let bootstrapGeneration = 0;
const BATCH_SIZE = 4;
/** Quiet time after the last edit before a finished script is learned. */
const SETTLE_MS = 90_000;

/** Stages whose scripts count as finished for learning: the configured
 *  learn stage and every later one. */
export function finishedStageIds(): string[] {
  return learnStageIds(agentSettings.learnStage(), scriptStages());
}

export function scheduleLearning(delayMs = 6000): void {
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
  if (currentProvider() !== p) throw new LearnInterrupted();
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
export async function existingScriptCount(): Promise<number> {
  const list = await api.listScripts({ sort: "updated", limit: 2000 }).catch(() => []);
  return list.filter((s) => Math.max(0, s.word_count) >= 15).length;
}

export async function startBootstrap(): Promise<void> {
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

export function cancelBootstrap(): void {
  bootstrapGeneration += 1;
  void activeLearnThread?.interrupt();
  setBootstrap((s) => ({ ...s, running: false, current: [] }));
}

/** Ends background learning and a running bootstrap: a learning run in
 *  flight stops at its next check, a scheduled one never starts.
 *  `resetProgress` also clears the bootstrap progress, `clearIndicator` the
 *  "learning" indicator. */
export function stopLearning(options: { resetProgress?: boolean; clearIndicator?: boolean } = {}): void {
  learnGeneration += 1;
  cancelBootstrap();
  if (options.resetProgress) setBootstrap(IDLE_BOOTSTRAP);
  if (learnTimer) clearTimeout(learnTimer);
  learnTimer = null;
  if (options.clearIndicator) setLearning(null);
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
