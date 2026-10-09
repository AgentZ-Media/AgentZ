import { createSignal } from "solid-js";
import { pushToast } from "@agentz/kit/stores";
import { t, tPlural } from "../../i18n";
import { api } from "../../lib/api";
import { scriptStages } from "../../lib/stages";
import { effortOrDefault } from "../../lib/agent/types";
import { learnStageIds } from "../../lib/agent/learnStage";
import { learnChange, worthRelearning } from "../../lib/agent/learnChange";
import { latestChat, learnedState, markLearned, saveChat } from "../../lib/agent/chats";
import { listMemory, selectRelevantMemory, type MemoryEntry } from "../../lib/agent/memory";
import { LEARN_RULES, memoryBlock, personaBlock } from "../../lib/agent/prompt";
import { blocksFromContent, charactersIn, hashBlocks, learnText } from "../../lib/agent/scriptText";
import { createChatTools, createMemoryTools, type MemoryChange } from "../../lib/agent/tools";
import type { AgentThread } from "../../lib/agent/types";
import type { ScriptSummary } from "../../lib/types";
import { agentSettings } from "../agentSettings";
import { agentUi } from "../agentUi";
import { navStore } from "../nav";
import { liveBlocks } from "../../components/Agent/editorBridge";
import { library } from "../../components/Shell/libraryData";
import { currentProvider, ensureModels, getProvider, refreshStatus, resolveModel, status } from "./provider";
import { currentPace, foldersMap, persona } from "./instructions";
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
/** A run was requested while one was going; it runs again afterwards. */
let learnAgain = false;
let learnGeneration = 0;
const learnFailures = new Map<string, number>();
/** Scripts checked without anything to learn, by the `updated_at` they had
 *  then. Every save schedules a run over all finished scripts; unchanged
 *  ones are not read, parsed and hashed again each time. */
const nothingToLearn = new Map<string, number>();
let activeLearnThread: AgentThread | null = null;
export interface LearnRef {
  id: string;
  title: string;
}

/** The script the agent is learning from right now. */
const [learning, setLearning] = createSignal<LearnRef | null>(null);
/** Scripts due for learning once their editing has settled. */
const [waiting, setWaiting] = createSignal<LearnRef[]>([]);
/** Bumps after a script was marked as learned (inspector reloads). */
const [learnedVersion, setLearnedVersion] = createSignal(0);
export { learning, waiting, learnedVersion };
/** Learned markers changed outside the learning loop (cloud sync). */
export const notifyLearnedChanged = () => setLearnedVersion((v) => v + 1);

interface LearnTarget {
  id: string;
  title: string;
  folderId: string | null;
  /** Characters of the script (picks the memory the turn starts with). */
  characters: string[];
  hash: string;
  /** `learnText` of the blocks, stored with the hash once learned. */
  text: string;
  /** Set when an earlier version was learned already: what is new since
   *  (both lists empty for markers from before the text was stored). */
  revision: { lines: string[]; newCharacters: string[] } | null;
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

/** Forgets the scripts shown as waiting (learning was switched off). */
export function clearWaiting(): void {
  setWaiting([]);
}

export function scheduleLearning(delayMs = 6000): void {
  if (learnTimer) clearTimeout(learnTimer);
  learnTimer = setTimeout(() => { learnTimer = null; void runLearning(); }, delayMs);
}

/** The script as a learning target, or null when there is nothing to learn:
 *  too short, unchanged since the last learning turn, or only changed a
 *  little (typos, small rewordings - see lib/agent/learnChange.ts).
 *  `undefined` when the script could not be read (checked again later). */
async function learnTargetFor(id: string): Promise<LearnTarget | null | undefined> {
  const script = await api.getScript(id).catch(() => null);
  if (!script) return undefined;
  const blocks = blocksFromContent(script.content_json);
  if (blocks.length < 3) return null;
  const hash = hashBlocks(blocks);
  const text = learnText(blocks);
  const learned = await learnedState(script.id);
  if (learned?.hash === hash) return null;
  let revision: LearnTarget["revision"] = null;
  if (learned) {
    if (learned.text === null) {
      revision = { lines: [], newCharacters: [] };
    } else {
      const change = learnChange(learned.text, text);
      if (!worthRelearning(change)) return null;
      revision = { lines: change.changedLines, newCharacters: change.newCharacters };
    }
  }
  return { id: script.id, title: script.title, folderId: script.folder_id, characters: charactersIn(blocks), hash, text, revision };
}

/** `learnTargetFor`, skipped for scripts unchanged since they last had
 *  nothing to learn. */
async function changedLearnTarget(summary: ScriptSummary): Promise<LearnTarget | null> {
  if (nothingToLearn.get(summary.id) === summary.updated_at) return null;
  const target = await learnTargetFor(summary.id);
  // A failed read says nothing about the script: it is not remembered.
  if (target === null) nothingToLearn.set(summary.id, summary.updated_at);
  else nothingToLearn.delete(summary.id);
  return target ?? null;
}

/** Forgets which scripts had nothing to learn (the learned markers were
 *  cleared, so every script may be due again). */
export function resetLearnChecks(): void {
  nothingToLearn.clear();
}

async function runLearning(): Promise<void> {
  if (learnRunning) {
    learnAgain = true;
    return;
  }
  // Only scripts finished after the agent was set up; older ones are
  // learned only through the explicit retroactive action.
  const since = agentSettings.learnSince();
  if (bootstrap().running || !agentSettings.enabled() || !agentSettings.onboarded() || !agentSettings.learnFromScripts()
    || status().state !== "ready" || since <= 0) {
    setWaiting([]);
    return;
  }
  learnRunning = true;
  learnAgain = false;
  const generation = learnGeneration;
  try {
    const now = Date.now();
    // The shared library list is in memory already; the query is only the
    // fallback before its first load.
    const stages = new Set(finishedStageIds());
    const candidates = library.loaded()
      ? library.scripts().filter((s) => stages.has(s.status))
      : (await Promise.all([...stages].map((status) => api.listScripts({ status, sort: "updated", limit: 500 })))).flat();
    const finished = candidates
      .filter((s) => Math.max(s.status_changed_at ?? 0, s.updated_at) > since)
      .sort((a, b) => b.updated_at - a.updated_at);
    // A finished script that is still being edited is learned once it has
    // been quiet for a while, not after every keystroke. Until then it is
    // shown as waiting.
    const settling: LearnRef[] = [];
    for (const summary of finished) {
      if (summary.updated_at <= now - SETTLE_MS || (learnFailures.get(summary.id) ?? 0) >= 2) continue;
      const target = await changedLearnTarget(summary);
      if (target) settling.push({ id: target.id, title: target.title });
    }
    if (generation !== learnGeneration) return;
    // Switched off while the scripts were being read: nothing is waiting.
    if (!agentSettings.enabled() || !agentSettings.learnFromScripts()) {
      setWaiting([]);
      return;
    }
    setWaiting(settling);
    if (settling.length) scheduleLearning(SETTLE_MS + 5000);
    for (const summary of finished) {
      if (summary.updated_at > now - SETTLE_MS) continue;
      if (generation !== learnGeneration || bootstrap().running || !agentSettings.enabled() || !agentSettings.learnFromScripts()) break;
      if ((learnFailures.get(summary.id) ?? 0) >= 2) continue;
      const target = await changedLearnTarget(summary);
      if (!target) continue;
      setLearning({ id: target.id, title: target.title });
      try {
        const changes = await learnBatch([target], "finished");
        await markLearned(target.id, target.hash, target.text);
        setLearnedVersion((v) => v + 1);
        if (changes.length) await appendLearnedToChat(target.id, changes);
        if (generation === learnGeneration) announceLearned(target, changes);
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
    if (learnAgain && generation === learnGeneration) scheduleLearning(1000);
    learnAgain = false;
  }
}

/** A short note after a learning turn: what changed in memory, with a way
 *  to the script's chat where each entry can be undone. */
function announceLearned(target: LearnTarget, changes: MemoryChange[]): void {
  const name = agentSettings.displayName();
  const title = target.title || t("common.untitled");
  if (changes.length === 0) {
    pushToast(t("agent.learned.nothing", { name, title }), "info", 4000);
    return;
  }
  pushToast(tPlural("agent.learned.toast", changes.length, { name, title }), "ok", undefined, {
    action: {
      label: t("agent.learned.show"),
      run: async () => {
        await navStore.openScript(target.id, target.title);
        agentUi.setChatOpen(target.id, true);
      },
    },
  });
}

/** A learning turn that did not finish (cancelled, agent switched off,
 *  timeout). Not a failure, but nothing may be marked as learned. */
class LearnInterrupted extends Error {
  constructor() {
    super("learning interrupted");
  }
}

/** Memory relevant to the scripts of a turn: for each of their folders,
 *  what a chat in that folder sees, over all their characters. The rest
 *  stays reachable through `get_memory`. */
function memoryForTargets(all: readonly MemoryEntry[], targets: readonly LearnTarget[]): MemoryEntry[] {
  const characters = [...new Set(targets.flatMap((target) => target.characters))];
  const keep = new Set<string>();
  for (const folderId of new Set(targets.map((target) => target.folderId))) {
    for (const entry of selectRelevantMemory(all, folderId, characters)) keep.add(entry.id);
  }
  return all.filter((entry) => keep.has(entry.id));
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
      memorySource: "script", memorySourceScriptId: sourceId, wpm: () => currentPace().wpm,
    }).filter((tool) => ["read_script", "list_scripts", "search_scripts", "list_folders"].includes(tool.name)),
    ...createMemoryTools({ scriptId: sourceId, onMemory: record, memorySource: "script", memorySourceScriptId: sourceId }),
  ];
  const relevant = memoryForTargets(all, targets);
  const memory = relevant.length > 0 || all.length === 0
    ? memoryBlock(relevant, folders)
    : "Nothing stored about these folders and characters yet.";
  const instructions = [
    personaBlock(persona()),
    LEARN_RULES,
    `Your memory about these scripts' folders and characters (get_memory reads everything):\n${memory}`,
  ].join("\n\n---\n\n");
  const thread = await p.openThread({ instructions, tools, ephemeral: true });
  activeLearnThread = thread;
  try {
    const model = resolveModel(list, agentSettings.learnModel() || agentSettings.model());
    const lines = targets.map((target) => {
      const folder = target.folderId ? folders.get(target.folderId)?.name ?? null : null;
      return `- "${target.title}" (id ${target.id})${folder ? ` in folder "${folder}"` : " (no folder)"}`;
    });
    const revision = kind === "finished" ? targets[0].revision : null;
    const intro = kind === "existing"
      ? "These are existing scripts the user wrote before you were set up. Look at them once to get to know the characters, folders and style:"
      : revision
        ? "This script was revised since you last learned from it. Your memory already holds what you learned from the earlier version; only store what is genuinely new:"
        : "This script was just finished:";
    const details: string[] = [];
    if (revision?.newCharacters.length) details.push(`New characters: ${revision.newCharacters.join(", ")}`);
    if (revision?.lines.length) details.push(`New or rewritten lines (excerpt):\n${revision.lines.join("\n")}`);
    const message = [`${intro}\n${lines.join("\n")}`, ...details].join("\n\n");
    const result = await thread.run(message, {
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

/** One learning turn over one script now, without the quiet period (the
 *  agent benchmark runs learning this way). Null when the script has nothing
 *  to learn; it is not marked as learned. */
export async function learnScript(id: string, onChange?: (change: MemoryChange) => void): Promise<MemoryChange[] | null> {
  const target = await learnTargetFor(id);
  return target ? learnBatch([target], "finished", onChange) : null;
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
      const target = await changedLearnTarget(summary);
      if (target) targets.push(target);
    }
    setBootstrap((s) => ({ ...s, total: targets.length }));
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      if (generation !== bootstrapGeneration) return;
      const batch = targets.slice(i, i + BATCH_SIZE);
      setBootstrap((s) => ({ ...s, current: batch.map((b) => b.title) }));
      try {
        await learnBatch(batch, "existing", (change) => setBootstrap((s) => ({ ...s, recent: [change, ...s.recent].slice(0, 6) })));
        for (const target of batch) await markLearned(target.id, target.hash, target.text);
        setLearnedVersion((v) => v + 1);
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
 *  "learning" and "waiting" indicators. */
export function stopLearning(options: { resetProgress?: boolean; clearIndicator?: boolean } = {}): void {
  learnGeneration += 1;
  cancelBootstrap();
  if (options.resetProgress) setBootstrap(IDLE_BOOTSTRAP);
  if (learnTimer) clearTimeout(learnTimer);
  learnTimer = null;
  if (options.clearIndicator) {
    setLearning(null);
    setWaiting([]);
  }
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
    : { id: crypto.randomUUID(), kind: "script", scriptId, provider: agentSettings.provider(), threadId: null, title: null, folderId: null, items, createdAt: now, updatedAt: now });
}
