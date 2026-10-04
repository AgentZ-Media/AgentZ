// Production stages of a script, configurable in the settings
// (Einstellungen > Stufen). The list is ordered; the first stage is where
// new scripts start, the last one means "done". `scripts.status` stores the
// stage id, so renaming or reordering never touches a script row.
//
// The four built-in ids (writing, ready, shot, online) are the shipped
// default and keep their translated names until the user gives them an own
// label. Stages added later get a random id.
//
// The list lives in a module-level signal so the storage layer
// (lib/scripts.ts) and every surface read the same order. The settings
// store loads and persists it (key `script_stages`); importing this file
// does no I/O.

import { createSignal } from "solid-js";
import { t, type TranslationKey } from "../i18n";

export interface StageDef {
  id: string;
  /** Own name. Unset = translated default (built-in ids only). */
  label?: string;
}

export const BUILTIN_STAGE_IDS = ["writing", "ready", "shot", "online"] as const;
export const DEFAULT_STAGES: readonly StageDef[] = BUILTIN_STAGE_IDS.map((id) => ({ id }));
export const MIN_STAGES = 2;
export const MAX_STAGES = 10;
export const MAX_STAGE_LABEL = 40;
export const STAGES_SETTING_KEY = "script_stages";

const STAGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const [stages, setStagesSignal] = createSignal<readonly StageDef[]>(DEFAULT_STAGES);

function isBuiltin(id: string): boolean {
  return (BUILTIN_STAGE_IDS as readonly string[]).includes(id);
}

/** Shape check for stage ids read from storage, files or settings.
 *  "idea" is reserved for the ideas page. */
export function isStageId(v: unknown): v is string {
  return typeof v === "string" && v !== "idea" && STAGE_ID_RE.test(v);
}

function cleanLabel(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const label = v.trim().slice(0, MAX_STAGE_LABEL);
  return label.length > 0 ? label : undefined;
}

/** Validates a stage list: 2-10 entries, unique well-formed ids, custom
 *  stages carry a name. Returns null when the list is unusable. */
export function normalizeStages(input: unknown): StageDef[] | null {
  if (!Array.isArray(input)) return null;
  const out: StageDef[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    if (!entry || typeof entry !== "object") return null;
    const { id, label } = entry as { id?: unknown; label?: unknown };
    if (!isStageId(id) || seen.has(id)) return null;
    seen.add(id);
    const clean = cleanLabel(label);
    if (!clean && !isBuiltin(id)) return null;
    out.push(clean ? { id, label: clean } : { id });
  }
  if (out.length < MIN_STAGES || out.length > MAX_STAGES) return null;
  return out;
}

/** Reads the stored setting; missing or broken values fall back to the
 *  default pipeline. */
export function parseStages(raw: string | null): StageDef[] {
  if (raw === null || raw.trim() === "") return [...DEFAULT_STAGES];
  try {
    const list = normalizeStages(JSON.parse(raw));
    if (list) return list;
  } catch {
    /* fall through */
  }
  console.warn("[scriptz] invalid script_stages setting, using defaults");
  return [...DEFAULT_STAGES];
}

export function serializeStages(list: readonly StageDef[]): string {
  return JSON.stringify(list.map((s) => (s.label ? { id: s.id, label: s.label } : { id: s.id })));
}

/** Reactive, ordered stage list. */
export const scriptStages = stages;

/** Replaces the active list (settings store only). Invalid lists are
 *  ignored. */
export function setScriptStages(list: readonly StageDef[]): void {
  const clean = normalizeStages(list);
  if (clean) setStagesSignal(clean);
}

/** Resets to the shipped default (runtime teardown, tests). */
export function resetScriptStages(): void {
  setStagesSignal(DEFAULT_STAGES);
}

export function stageIds(): string[] {
  return stages().map((s) => s.id);
}

export function isKnownStage(id: unknown): id is string {
  return typeof id === "string" && stages().some((s) => s.id === id);
}

export function firstStageId(): string {
  return stages()[0].id;
}

export function finalStageId(): string {
  const list = stages();
  return list[list.length - 1].id;
}

/** Known stage id, else the first stage. Rows whose stage no longer exists
 *  (manual DB edit, file from another install) show up at the start of the
 *  pipeline instead of disappearing. */
export function resolveStageId(id: unknown): string {
  return isKnownStage(id) ? id : firstStageId();
}

/** Position in the pipeline; unknown ids count as the first stage. */
export function stageIndex(id: string): number {
  return Math.max(0, stages().findIndex((s) => s.id === id));
}

export function isFinalStage(id: string): boolean {
  return resolveStageId(id) === finalStageId();
}

/** Translated default name of a built-in stage, null for custom ids. */
export function defaultStageLabel(id: string): string | null {
  return isBuiltin(id) ? t(`stage.${id}` as TranslationKey) : null;
}

/** Display name ("Drehbereit", or the user's own name). */
export function stageLabel(id: string): string {
  const def = stages().find((s) => s.id === id) ?? stages()[0];
  return def.label ?? defaultStageLabel(def.id) ?? def.id;
}

export function newStageId(): string {
  return crypto.randomUUID();
}
