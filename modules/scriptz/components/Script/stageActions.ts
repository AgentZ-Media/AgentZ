// Stage changes of a script (Schreiben -> Drehbereit -> Gedreht -> Online)
// with an undo toast. Used by the stage chip in the script top bar and by
// the shell's ⌘⌥→ / ⌘⌥← shortcuts (via `stepStage`).
//
// The undo toast lives here as module state so it survives whichever
// component triggered the change; `StageUndoToast` (StageToast.tsx) renders
// it. While no toast host is mounted the change is confirmed with a plain
// toast instead (no undo).
//
// Calls are serialized: a burst of ⌘⌥→ presses reads the status written by
// the previous step instead of racing on the same stale value. Within a
// burst the toast keeps the status from BEFORE the first step, so one undo
// reverts the whole burst.

import { createSignal } from "solid-js";
import { api } from "../../lib/api";
import { scriptsBus } from "../../lib/scriptsBus";
import { SCRIPT_STATUSES, type ScriptStatus } from "../../lib/types";
import { pushToast } from "../../stores/toasts";
import { t, type TranslationKey } from "../../i18n";

const TOAST_MS = 5000;

export interface StageUndoState {
  /** Increments for every new toast so the view can restart its timer. */
  id: number;
  scriptId: string;
  status: ScriptStatus;
  previous: ScriptStatus;
}

const [undoState, setUndoState] = createSignal<StageUndoState | null>(null);
let nextId = 1;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
// Mounted toast hosts (ScriptScreen, possibly the shell). Only the first
// one renders, so mounting it twice never shows two toasts.
const [hosts, setHosts] = createSignal<number[]>([]);
let nextHostId = 1;
let queue: Promise<void> = Promise.resolve();

/** Localized stage name ("Drehbereit"). */
export function stageLabel(status: ScriptStatus): string {
  return t(`stage.${status}` as TranslationKey);
}

function serialize(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function showUndo(scriptId: string, status: ScriptStatus, previous: ScriptStatus) {
  if (hosts().length === 0) {
    pushToast(t("script.stage.toast", { stage: stageLabel(status) }), "ok");
    return;
  }
  const cur = undoState();
  // Same script, toast still visible: keep the original "previous" so a
  // single undo reverts the whole burst.
  const prev = cur && cur.scriptId === scriptId ? cur.previous : previous;
  if (prev === status) {
    dismissStageUndo();
    return;
  }
  setUndoState({ id: nextId++, scriptId, status, previous: prev });
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(dismissStageUndo, TOAST_MS);
}

async function applyStatus(scriptId: string, next: ScriptStatus): Promise<void> {
  const current = (await api.getScript(scriptId)).status;
  if (current === next) return;
  await api.setScriptStatus(scriptId, next);
  scriptsBus.bump();
  showUndo(scriptId, next, current);
}

function reportError(err: unknown) {
  pushToast(
    t("script.stage.failed", { message: (err as Error)?.message ?? String(err) }),
    "error",
  );
}

/** Sets a script's stage and offers an undo toast. No-op if the script is
 *  already at that stage. Errors surface as an error toast. */
export async function setStageWithUndo(scriptId: string, status: ScriptStatus): Promise<void> {
  await serialize(async () => {
    try {
      await applyStatus(scriptId, status);
    } catch (err) {
      reportError(err);
    }
  });
}

/** Moves a script one stage forward (1) or back (-1), clamped to the
 *  pipeline ends (no wrap-around). */
export async function stepStage(scriptId: string, dir: 1 | -1): Promise<void> {
  await serialize(async () => {
    try {
      const current = (await api.getScript(scriptId)).status;
      const idx = SCRIPT_STATUSES.indexOf(current);
      const nextIdx = Math.min(SCRIPT_STATUSES.length - 1, Math.max(0, idx + dir));
      if (nextIdx === idx) return;
      await applyStatus(scriptId, SCRIPT_STATUSES[nextIdx]);
    } catch (err) {
      reportError(err);
    }
  });
}

// ---- toast state (read by StageToast.tsx) ----

export const stageUndo = undoState;

export function dismissStageUndo(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  setUndoState(null);
}

/** Reverts the change shown in the undo toast. */
export async function undoStageChange(): Promise<void> {
  const st = undoState();
  if (!st) return;
  dismissStageUndo();
  await serialize(async () => {
    try {
      await api.setScriptStatus(st.scriptId, st.previous);
      scriptsBus.bump();
    } catch (err) {
      reportError(err);
    }
  });
}

/** Called by StageUndoToast on mount. Returns the host id and an
 *  unregister function. */
export function registerStageToastHost(): { id: number; unregister: () => void } {
  const id = nextHostId++;
  setHosts((h) => [...h, id]);
  return {
    id,
    unregister: () => {
      const rest = hosts().filter((h) => h !== id);
      setHosts(rest);
      if (rest.length === 0) dismissStageUndo();
    },
  };
}

/** True for the host that renders the toast (the oldest mounted one). */
export function isPrimaryStageToastHost(id: number): boolean {
  return hosts()[0] === id;
}
