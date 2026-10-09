// Benchmark data: one JSON file per suite in data/ (written by the suite's
// runner, e.g. modules/scriptz/bench/agentModels.run.ts) and the averages
// the page shows. Format version 2 mirrors `BenchRun` of that runner; chat
// items have the shape the app stores (lib/agent/chats.ts).

export interface Text { de: string; en: string }

export type BlockType = "action" | "character" | "dialog" | "parenthetical";
export interface Block { type: BlockType; text: string }

export interface Proposal {
  target: { mode: string; from?: number; to?: number; block?: number };
  options: { title: string; note: string; blocks: Block[]; conflictBlock?: number }[];
  currentConflict?: number;
}

export interface Claim {
  quote: string;
  verdict: "correct" | "imprecise" | "wrong" | "unclear";
  explanation: string;
  sources: { title: string; url: string }[];
  fix: { blocks: Block[] } | null;
}

export interface IdeaCard { title: string; premise: string; hook: string; characters: string[]; seconds: number | null }

export interface MemoryEntry { id: string; kind: string; folderId: string | null; subject: string | null; content: string }

export type ChatItem =
  | { kind: "user"; id: string; text: string; quote?: string; job?: string }
  | { kind: "assistant"; id: string; text: string; commentary?: boolean }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "tool"; id: string; tool: string; args: Record<string, unknown>; status: string }
  | { kind: "search"; id: string; query: string; status: string }
  | { kind: "proposal"; id: string; proposal: Proposal }
  | { kind: "claims"; id: string; claims: Claim[] }
  | { kind: "memory"; id: string; action: "added" | "updated" | "removed"; entry: MemoryEntry; previous?: MemoryEntry }
  | { kind: "ideas"; id: string; ideas: IdeaCard[] }
  | { kind: "ideas-saved"; id: string }
  | { kind: "replies"; id: string; replies: string[] }
  | { kind: "error"; id: string; message: string }
  | { kind: "interrupted" | "blocked" | "handoff" | "draft-discarded"; id: string };

export interface Check { id: string; label: Text; pass: boolean; detail?: string }

export interface StepLog {
  task: string;
  kind: "step" | "search";
  provider: string | null;
  atMs: number;
  ms: number;
  firstMs: number | null;
  toolCalls: { name: string; args: string }[];
  usage: Record<string, unknown> | null;
  billedUsd: number | null;
  error: string | null;
}

export interface BenchRun {
  id: string;
  batch: string;
  at: string;
  commit: string;
  profile: string;
  task: string;
  taskLabel: Text;
  model: string;
  modelName: string;
  effort: string;
  rep: number;
  promptHash: string;
  pricing: Record<string, string> | null;
  status: "completed" | "failed";
  error?: string;
  ms: number;
  firstOutputMs: number | null;
  steps: number;
  failedSteps: number;
  searches: number;
  tokens: { prompt: number; cached: number; cacheWrite: number; completion: number; reasoning: number };
  costUsd: number;
  costSource: "generation" | "usage";
  searchCostUsd: number;
  items: ChatItem[];
  claim?: { claim: Claim | null; note: string };
  memoryChanges?: { action: string; entry: MemoryEntry }[];
  toolCalls: { name: string; args: string; atMs: number }[];
  checks: Check[];
  judge: { model: string; score: number; reason: Text; costUsd: number } | null;
  stepLog: StepLog[];
}

export interface ProfileInfo {
  id: string;
  name: string;
  about: Text;
  persona: { name: string; userName: string; traits: string[]; instructions: string };
  wpm: number;
  folders: { key: string; name: string; minSec: number | null; maxSec: number | null }[];
  scripts: { key: string; title: string; folder: string; stage: string; body: string }[];
  memory: { kind: string; folder: string | null; subject?: string; content: string }[];
  ideas: { title: string; notes: string; folder: string | null }[];
}

export interface TaskInfo {
  id: string;
  profile: string;
  label: Text;
  mode: "script" | "session" | "claim" | "learn";
  script: string | null;
  folder: string | null;
  rubric: string;
  /** What the user sends (job label or message), the line for a fact check. */
  message: string | null;
  quote: string | null;
  /** What the model gets instead of the message (fixed jobs). */
  instruction: string | null;
  lineIndex: number | null;
}

export interface Suite { id: string; title: Text; profiles: ProfileInfo[]; tasks: TaskInfo[]; runs: BenchRun[] }

const TITLES: Record<string, Text> = { "scriptz-agent": { de: "ScriptZ-Agent", en: "ScriptZ agent" } };

interface SuiteFile { version: number; profiles?: ProfileInfo[]; tasks?: TaskInfo[]; runs?: BenchRun[] }

export function loadSuites(): Suite[] {
  const files = import.meta.glob<SuiteFile>("../data/*.json", { eager: true, import: "default" });
  return Object.entries(files).map(([path, file]) => {
    const id = path.replace(/^.*\/|\.json$/g, "");
    const runs = file.version === 2 ? file.runs ?? [] : [];
    return { id, title: TITLES[id] ?? { de: id, en: id }, profiles: file.profiles ?? [], tasks: file.tasks ?? [], runs };
  });
}

/** Models in the order they first appear: a model keeps its color as the
 *  data grows. */
export function modelsOf(runs: BenchRun[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const run of runs) if (!seen.has(run.model)) seen.set(run.model, run.modelName);
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** Tasks in definition order, then tasks only old runs know. */
export function tasksOf(suite: Suite, runs: BenchRun[]): { id: string; label: Text; profile: string }[] {
  const out = new Map<string, { id: string; label: Text; profile: string }>();
  for (const task of suite.tasks) out.set(task.id, { id: task.id, label: task.label, profile: task.profile });
  for (const run of runs) if (!out.has(run.task)) out.set(run.task, { id: run.task, label: run.taskLabel, profile: run.profile });
  return [...out.values()].filter((t) => runs.some((r) => r.task === t.id));
}

/** Only the runs of each task's newest prompt state (instructions, tools
 *  and message), so a prompt change does not mix old and new results. */
export function newestState(runs: BenchRun[]): BenchRun[] {
  const newest = new Map<string, { at: string; hash: string }>();
  for (const run of runs) {
    const current = newest.get(run.task);
    if (run.promptHash && (!current || run.at > current.at)) newest.set(run.task, { at: run.at, hash: run.promptHash });
  }
  return runs.filter((run) => !run.promptHash || newest.get(run.task)?.hash === run.promptHash);
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export interface Stats {
  n: number;
  failed: number;
  cost: number | null;
  costMin: number | null;
  costMax: number | null;
  ms: number | null;
  firstMs: number | null;
  score: number | null;
  checks: number | null;
  failedSteps: number | null;
  tokens: { prompt: number; cached: number; completion: number; reasoning: number } | null;
  steps: number | null;
  searches: number | null;
}

export function stats(runs: BenchRun[]): Stats {
  const done = runs.filter((r) => r.status === "completed");
  const costs = done.map((r) => r.costUsd * 100);
  const judged = done.filter((r) => r.judge);
  const checkRatios = done.filter((r) => r.checks.length).map((r) => r.checks.filter((c) => c.pass).length / r.checks.length);
  const firsts = done.map((r) => r.firstOutputMs).filter((v): v is number => v !== null);
  const tok = (pick: (r: BenchRun) => number) => mean(done.map(pick)) ?? 0;
  return {
    n: done.length,
    failed: runs.length - done.length,
    cost: mean(costs),
    costMin: costs.length ? Math.min(...costs) : null,
    costMax: costs.length ? Math.max(...costs) : null,
    ms: mean(done.map((r) => r.ms)),
    firstMs: mean(firsts),
    score: mean(judged.map((r) => r.judge!.score)),
    checks: mean(checkRatios),
    failedSteps: mean(runs.map((r) => r.failedSteps ?? 0)),
    tokens: done.length
      ? { prompt: tok((r) => r.tokens.prompt), cached: tok((r) => r.tokens.cached), completion: tok((r) => r.tokens.completion), reasoning: tok((r) => r.tokens.reasoning) }
      : null,
    steps: mean(done.map((r) => r.steps)),
    searches: mean(done.map((r) => r.searches)),
  };
}

/** Per model: the mean over its tasks (each task weighs the same). */
export function overview(runs: BenchRun[], model: string, tasks: { id: string }[]) {
  const all = runs.filter((r) => r.model === model);
  const perTask = tasks.map((t) => stats(all.filter((r) => r.task === t.id))).filter((s) => s.n > 0);
  const pick = (f: (s: Stats) => number | null) => mean(perTask.map(f).filter((v): v is number => v !== null));
  return {
    tasks: perTask.length,
    runs: all.length,
    completed: all.length ? all.filter((r) => r.status === "completed").length / all.length : null,
    cost: pick((s) => s.cost),
    ms: pick((s) => s.ms),
    firstMs: pick((s) => s.firstMs),
    score: pick((s) => s.score),
    checks: pick((s) => s.checks),
    failedSteps: mean(all.map((r) => r.failedSteps ?? 0)),
  };
}

/** Script text in the draft format (`NAME (cue): line`) as blocks. */
export function parseScript(body: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^([^:()]{1,40}?)\s*(?:\(([^)]{1,80})\))?\s*:\s*(.*)$/.exec(line);
    if (match && /^(ACTION|AKTION|REGIE)$/i.test(match[1].trim())) blocks.push({ type: "action", text: match[3] });
    else if (match && match[1] === match[1].toUpperCase()) {
      blocks.push({ type: "character", text: match[1].trim() });
      if (match[2]) blocks.push({ type: "parenthetical", text: `(${match[2]})` });
      if (match[3]) blocks.push({ type: "dialog", text: match[3] });
    } else blocks.push({ type: "action", text: line });
  }
  return blocks;
}
