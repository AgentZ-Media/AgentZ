import { createSignal, createEffect, createRoot } from "solid-js";
import { getKvStore, type KvStore } from "@agentz/kit/platform";
import { baseSettingsStore, createSettingsWriter } from "@agentz/kit/stores";
import {
  STAGES_SETTING_KEY,
  normalizeStages,
  parseStages,
  resetScriptStages,
  scriptStages,
  serializeStages,
  setScriptStages,
  type StageDef,
} from "../lib/stages";

const [highlightingDefault, setHighlightingDefault] = createSignal<boolean>(false);
const [exportTitlePageDefault, setExportTitlePageDefault] = createSignal<boolean>(true);
// Open scripts in focus mode. Default false for fresh installs since the
// Werkbank redesign (head bar + inspector are the normal writing view);
// a value stored by an existing install still wins (see load()).
const [focusModeDefault, setFocusModeDefault] = createSignal<boolean>(false);
// Typewriter in focus mode: the caret line stays in the middle of the
// screen and the other lines step back. Default off.
const [focusTypewriter, setFocusTypewriter] = createSignal<boolean>(false);
// Auto-flip quick mode on whenever a script has exactly two characters.
// Per-script manual toggle still wins — once the writer overrides it on a
// script, that decision sticks across character-count changes.
const [quickModeAutoEnable, setQuickModeAutoEnable] = createSignal<boolean>(false);
// Show the adaptive writing counter (sidebar footer: words this week /
// month / year / total, see lib/writingCounter.ts). Key kept from the old
// "writing stats" switch; default ON since the redesign - the counter has
// no goal and no streak, so it informs without creating pressure.
const [showWritingStats, setShowWritingStats] = createSignal<boolean>(true);
// Full dark immersion: script sheet also dark in dark mode instead of light.
// Default off — most users like the "illuminated paper" look, but
// for OLED / late-night writing the sheet is perceived as too bright.
// Only applies when the resolved theme is actually "dark" (light
// mode ignores the setting; in auto mode it depends on the system).
const [darkPaper, setDarkPaper] = createSignal<boolean>(false);
// Keep only character names that some stored script still uses: names
// that drop out of every script are deleted from the colour registry in
// the background (lib/characterAutoPrune.ts). Default off - deleting a
// name also forgets its colour.
const [pruneUnusedCharacters, setPruneUnusedCharacters] = createSignal<boolean>(false);

// A click on a script in a list or on the board opens it in the side panel
// next to the list instead of the full script view. Default on; Alt-click
// does the other one.
const [openInPanel, setOpenInPanel] = createSignal<boolean>(true);
// Scripts that reach the last stage leave the sidebar's "Open" list (the
// script on screen stays until the writer switches away). Default on.
const [closeFinishedScripts, setCloseFinishedScripts] = createSignal<boolean>(true);

// Words per minute for the runtime estimate (inspector, list, timeline).
// Default 210 is calibrated for TikTok / sketch pace.
// Classic screenplay pace is around 150, fast speech around ~250.
const DIALOG_WPM_DEFAULT = 210;
const DIALOG_WPM_MIN = 80;
const DIALOG_WPM_MAX = 400;
const [dialogWpm, setDialogWpm] = createSignal<number>(DIALOG_WPM_DEFAULT);

// Default target runtime range in whole seconds (docs/feature-laengenziel.md).
// Applies when a script's folder has no own range. null = bound unset;
// both null = no range at all. Persisted as "" when unset.
const LENGTH_SEC_MAX = 24 * 60 * 60;
const [lengthMinDefaultSec, setLengthMinDefaultSecSignal] = createSignal<number | null>(null);
const [lengthMaxDefaultSec, setLengthMaxDefaultSecSignal] = createSignal<number | null>(null);

const [loaded, setLoaded] = createSignal(false);
let stopRuntime: (() => void) | undefined;
let runtimeGeneration = 0;
let settingsKv: KvStore | undefined;
let writer: ReturnType<typeof createSettingsWriter> | undefined;

/** Normalizes a stored/typed range bound: non-negative whole seconds or
 *  null. Ordering (min < max) is the UI's job - lib/lengthGoal.ts treats
 *  an inverted pair defensively. */
function cleanLengthSec(n: number | null): number | null {
  if (n === null || !Number.isFinite(n) || n < 0) return null;
  return Math.min(LENGTH_SEC_MAX, Math.round(n));
}

function parseLengthSetting(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  return cleanLengthSec(Number(raw));
}

function clampWpm(n: number): number {
  if (!Number.isFinite(n)) return DIALOG_WPM_DEFAULT;
  return Math.max(DIALOG_WPM_MIN, Math.min(DIALOG_WPM_MAX, Math.round(n)));
}

function persistSetting(key: string, value: string): Promise<void> {
  if (!writer) throw new Error("Product settings runtime has not started.");
  return writer.write(key, value);
}

export const settingsStore = {

  highlightingDefault,
  setHighlightingDefault: async (v: boolean) => {
    setHighlightingDefault(v);
    await persistSetting("highlighting_default", v ? "1" : "0");
  },
  exportTitlePageDefault,
  setExportTitlePageDefault: async (v: boolean) => {
    setExportTitlePageDefault(v);
    await persistSetting("export_title_page_default", v ? "1" : "0");
  },

  focusModeDefault,
  setFocusModeDefault: async (v: boolean) => {
    setFocusModeDefault(v);
    await persistSetting("focus_mode_default", v ? "1" : "0");
  },
  focusTypewriter,
  setFocusTypewriter: async (v: boolean) => {
    setFocusTypewriter(v);
    await persistSetting("focus_typewriter", v ? "1" : "0");
  },
  quickModeAutoEnable,
  setQuickModeAutoEnable: async (v: boolean) => {
    setQuickModeAutoEnable(v);
    await persistSetting("quick_mode_auto_enable", v ? "1" : "0");
  },
  showWritingStats,
  setShowWritingStats: async (v: boolean) => {
    setShowWritingStats(v);
    await persistSetting("show_writing_stats", v ? "1" : "0");
  },
  darkPaper,
  setDarkPaper: async (v: boolean) => {
    setDarkPaper(v);
    await persistSetting("dark_paper", v ? "1" : "0");
  },
  pruneUnusedCharacters,
  setPruneUnusedCharacters: async (v: boolean) => {
    setPruneUnusedCharacters(v);
    await persistSetting("prune_unused_characters", v ? "1" : "0");
  },
  openInPanel,
  setOpenInPanel: async (v: boolean) => {
    setOpenInPanel(v);
    await persistSetting("open_scripts_in_panel", v ? "1" : "0");
  },
  closeFinishedScripts,
  setCloseFinishedScripts: async (v: boolean) => {
    setCloseFinishedScripts(v);
    await persistSetting("close_finished_scripts", v ? "1" : "0");
  },
  dialogWpm,
  setDialogWpm: async (v: number) => {
    const next = clampWpm(v);
    setDialogWpm(next);
    await persistSetting("dialog_wpm", String(next));
  },
  DIALOG_WPM_MIN,
  DIALOG_WPM_MAX,
  DIALOG_WPM_DEFAULT,
  /** Default range lower bound in seconds; null = unset. */
  lengthMinDefaultSec,
  setLengthMinDefaultSec: async (v: number | null) => {
    const next = cleanLengthSec(v);
    setLengthMinDefaultSecSignal(next);
    await persistSetting("length_min_default_sec", next === null ? "" : String(next));
  },
  /** Default range upper bound in seconds; null = unset. */
  lengthMaxDefaultSec,
  setLengthMaxDefaultSec: async (v: number | null) => {
    const next = cleanLengthSec(v);
    setLengthMaxDefaultSecSignal(next);
    await persistSetting("length_max_default_sec", next === null ? "" : String(next));
  },

  /** Ordered production stages (see lib/stages.ts). */
  scriptStages,
  /** Replaces the stage list. Scripts of a removed stage must be moved
   *  first (`api.reassignScriptStatus`). Throws on an invalid list. */
  setScriptStages: async (list: readonly StageDef[]) => {
    const next = normalizeStages(list);
    if (!next) throw new Error("invalid stage list");
    setScriptStages(next);
    await persistSetting(STAGES_SETTING_KEY, serializeStages(next));
  },

  loaded,
  async load() {
    const generation = runtimeGeneration;
    const kv = settingsKv ?? getKvStore();
    const [hd, etpd, qmae, wpm, fmd, sws, dp, lmin, lmax, puc, stages, oip, cfs, ftw] = await Promise.all([
      kv.getSetting("highlighting_default"),
      kv.getSetting("export_title_page_default"),
      kv.getSetting("quick_mode_auto_enable"),
      kv.getSetting("dialog_wpm"),
      kv.getSetting("focus_mode_default"),
      kv.getSetting("show_writing_stats"),
      kv.getSetting("dark_paper"),
      kv.getSetting("length_min_default_sec"),
      kv.getSetting("length_max_default_sec"),
      kv.getSetting("prune_unused_characters"),
      kv.getSetting(STAGES_SETTING_KEY),
      kv.getSetting("open_scripts_in_panel"),
      kv.getSetting("close_finished_scripts"),
      kv.getSetting("focus_typewriter"),
    ]);
    if (generation !== runtimeGeneration) return;
    setHighlightingDefault(hd === null ? false : hd === "1");
    setExportTitlePageDefault(etpd === null ? true : etpd === "1");
    setQuickModeAutoEnable(qmae === null ? false : qmae === "1");
    setFocusModeDefault(fmd === null ? false : fmd === "1");
    setFocusTypewriter(ftw === "1");
    setShowWritingStats(sws === null ? true : sws === "1");
    setDarkPaper(dp === null ? false : dp === "1");
    setPruneUnusedCharacters(puc === null ? false : puc === "1");
    setOpenInPanel(oip === null ? true : oip === "1");
    setCloseFinishedScripts(cfs === null ? true : cfs === "1");
    setLengthMinDefaultSecSignal(parseLengthSetting(lmin));
    setLengthMaxDefaultSecSignal(parseLengthSetting(lmax));
    setDialogWpm(wpm === null ? DIALOG_WPM_DEFAULT : clampWpm(Number(wpm)));
    setScriptStages(parseStages(stages));
    setLoaded(true);
  },
};

/** Product-owned writing surface follows the shared resolved chrome theme. */
export function startSettingsRuntime(kv: KvStore = getKvStore()): () => void {
  if (stopRuntime) return stopRuntime;
  runtimeGeneration += 1;
  setLoaded(false);
  settingsKv = kv;
  const runtimeWriter = createSettingsWriter(kv, "product-settings");
  writer = runtimeWriter;
  const disposeRoot = createRoot((dispose) => {
    createEffect(() => {
      if (!loaded() || !baseSettingsStore.loaded() || typeof document === "undefined") return;
      if (baseSettingsStore.resolvedTheme() === "dark" && darkPaper()) document.documentElement.dataset.paper = "dark";
      else delete document.documentElement.dataset.paper;
    });
    return dispose;
  });
  let active = true;
  const stop = () => {
    if (!active) return;
    active = false;
    runtimeGeneration += 1;
    disposeRoot();
    runtimeWriter.dispose();
    if (typeof document !== "undefined") delete document.documentElement.dataset.paper;
    writer = undefined;
    settingsKv = undefined;
    resetScriptStages();
    setLoaded(false);
    stopRuntime = undefined;
  };
  stopRuntime = stop;
  return stop;
}
