import { createSignal, createEffect } from "solid-js";
import { api } from "../lib/api";
import { registerFlusher } from "../lib/saveFlush";
import {
  applyResolvedLanguage,
  detectSystemLanguage,
  resolveLanguage,
  type Language,
  type LanguagePref,
} from "../i18n";

export type Theme = "dark" | "light" | "auto";

const [theme, setTheme] = createSignal<Theme>("light");
const [highlightingDefault, setHighlightingDefault] = createSignal<boolean>(false);
const [updateCheckEnabled, setUpdateCheckEnabled] = createSignal<boolean>(true);
const [hourlyUpdateCheck, setHourlyUpdateCheck] = createSignal<boolean>(true);
// Open scripts in focus mode. Default false for fresh installs since the
// Werkbank redesign (head bar + inspector are the normal writing view);
// a value stored by an existing install still wins (see load()).
const [focusModeDefault, setFocusModeDefault] = createSignal<boolean>(false);
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

// Permanent ScriptZ Studio connect code ("scriptzk1_..."), pasted in the
// settings. Empty string = not connected. While empty, the app shows no
// Studio surface at all (no "Send to Studio" button) - most users don't
// have a Studio. Validation happens in the settings UI via
// lib/handoff.ts::parseConnectCode before this value is persisted.
const [studioConnectCode, setStudioConnectCodeSignal] = createSignal<string>("");

// Language preference "auto" | "de" | "en". "auto" follows navigator.language.
// Default "auto" - new users land language-wise where their system is.
// The resolved language is not persisted here, only the user's choice;
// the i18n module resolves again on every load, so a system
// switch doesn't get stuck on a stale cached language.
const [language, setLanguagePref] = createSignal<LanguagePref>("auto");

const [loaded, setLoaded] = createSignal(false);

// matchMedia + resolved theme - declared early so that settingsStore.resolvedTheme
// works in the store definition below without a forward reference.
const prefersDark =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function resolveTheme(t: Theme): "dark" | "light" {
  if (t === "auto") return prefersDark?.matches ? "dark" : "light";
  return t;
}

// Reactive "is the app currently dark?" - UI components need this,
// e.g. to (de)activate the darkPaper option. Stays on the current
// system state in auto mode (listener further below).
const [resolvedTheme, setResolvedTheme] = createSignal<"dark" | "light">(
  resolveTheme(theme()),
);

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

// Settings writes: every setter updates its signal synchronously and queues
// the storage write behind the previous write of the same key. Rapid
// toggles (on/off/on) thereby land in order - the last choice is what
// stays stored - and flushAll() (route change, window close) waits for
// writes still in flight. Errors still reject the setter's promise.
const settingWrites = new Map<string, Promise<void>>();
const pendingSettingWrites = new Set<Promise<void>>();

function persistSetting(key: string, value: string): Promise<void> {
  const prev = settingWrites.get(key) ?? Promise.resolve();
  const write = prev.catch(() => {}).then(() => api.setSetting(key, value));
  settingWrites.set(key, write);
  pendingSettingWrites.add(write);
  void write
    .catch(() => {})
    .finally(() => {
      pendingSettingWrites.delete(write);
      if (settingWrites.get(key) === write) settingWrites.delete(key);
    });
  return write;
}

registerFlusher(async () => {
  await Promise.allSettled([...pendingSettingWrites]);
});

function applyLanguage(pref: LanguagePref): void {
  const lang: Language = resolveLanguage(pref);
  applyResolvedLanguage(lang);
}

export const settingsStore = {
  theme,
  setTheme: async (v: Theme) => {
    setTheme(v);
    // dataset.theme is set by the createEffect below — no redundant
    // writing here anymore.
    await persistSetting("theme", v);
  },
  highlightingDefault,
  setHighlightingDefault: async (v: boolean) => {
    setHighlightingDefault(v);
    await persistSetting("highlighting_default", v ? "1" : "0");
  },
  updateCheckEnabled,
  setUpdateCheckEnabled: async (v: boolean) => {
    setUpdateCheckEnabled(v);
    await persistSetting("update_check_enabled", v ? "1" : "0");
  },
  hourlyUpdateCheck,
  setHourlyUpdateCheck: async (v: boolean) => {
    setHourlyUpdateCheck(v);
    await persistSetting("hourly_update_check", v ? "1" : "0");
  },
  focusModeDefault,
  setFocusModeDefault: async (v: boolean) => {
    setFocusModeDefault(v);
    await persistSetting("focus_mode_default", v ? "1" : "0");
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
  resolvedTheme,
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
  studioConnectCode,
  setStudioConnectCode: async (v: string) => {
    const next = v.trim();
    setStudioConnectCodeSignal(next);
    await persistSetting("studio_connect_code", next);
  },
  /** Current user choice "auto" | "de" | "en". */
  language,
  setLanguage: async (v: LanguagePref) => {
    setLanguagePref(v);
    applyLanguage(v);
    await persistSetting("language", v);
  },
  loaded,
  async load() {
    const [t, hd, uce, huc, qmae, wpm, fmd, sws, dp, lang, scc, lmin, lmax] = await Promise.all([
      api.getSetting("theme"),
      api.getSetting("highlighting_default"),
      api.getSetting("update_check_enabled"),
      api.getSetting("hourly_update_check"),
      api.getSetting("quick_mode_auto_enable"),
      api.getSetting("dialog_wpm"),
      api.getSetting("focus_mode_default"),
      api.getSetting("show_writing_stats"),
      api.getSetting("dark_paper"),
      api.getSetting("language"),
      api.getSetting("studio_connect_code"),
      api.getSetting("length_min_default_sec"),
      api.getSetting("length_max_default_sec"),
    ]);
    if (t === "dark" || t === "light" || t === "auto") setTheme(t);
    if (hd) setHighlightingDefault(hd === "1");
    if (uce) setUpdateCheckEnabled(uce === "1");
    if (huc) setHourlyUpdateCheck(huc === "1");
    if (qmae) setQuickModeAutoEnable(qmae === "1");
    if (fmd) setFocusModeDefault(fmd === "1");
    if (sws) setShowWritingStats(sws === "1");
    if (dp) setDarkPaper(dp === "1");
    if (scc) setStudioConnectCodeSignal(scc);
    setLengthMinDefaultSecSignal(parseLengthSetting(lmin));
    setLengthMaxDefaultSecSignal(parseLengthSetting(lmax));
    // Language: persisted value takes precedence, otherwise default "auto".
    // Existing users thereby get their system language without an explicit
    // migration (auto-detection on the first resolve).
    if (lang === "auto" || lang === "de" || lang === "en") {
      setLanguagePref(lang);
    }
    applyLanguage(language());
    if (wpm) {
      const parsed = Number(wpm);
      if (Number.isFinite(parsed)) setDialogWpm(clampWpm(parsed));
    }
    setLoaded(true);
  },
};

// Apply theme to the document. "auto" is resolved via matchMedia (declared
// above) to "dark" or "light", so the CSS only knows
// two sources of truth - otherwise every dark token block would have to
// be maintained twice (once for [data-theme="dark"], once
// for @media + auto), which in the past has led to incomplete
// auto blocks and style-layer bugs.
//
// Solid tracks theme() as a dependency and fires on every change,
// including the first read/set at the end of load().
//
// Before `load()` has run, we don't write anything - otherwise
// the default ("light") would briefly flicker over the persisted theme,
// because this effect already fires once on module import.
// data-paper strictly follows the **resolved** theme: only when the theme
// (incl. auto resolution) is actually dark does data-paper="dark"
// get set. In light mode the attribute is removed so the user
// setting "darkPaper" has no effect here - the sheet stays
// light. That way the auto logic works out of the box: user enables
// darkPaper once, and the sheet only goes dark when the
// app is currently in the dark look.
function applyChrome() {
  const resolved = resolveTheme(theme());
  setResolvedTheme(resolved);
  document.documentElement.dataset.theme = resolved;
  if (resolved === "dark" && darkPaper()) {
    document.documentElement.dataset.paper = "dark";
  } else {
    delete document.documentElement.dataset.paper;
  }
}

createEffect(() => {
  if (!loaded()) return;
  // Track theme() and darkPaper() — both trigger applyChrome.
  theme();
  darkPaper();
  applyChrome();
});

// Follow system changes live, as long as the user is on "auto".
// Without this listener, auto mode would resolve correctly on app start,
// but would not react if the user changed the system theme
// during the session. applyChrome() also gets the darkPaper attribute
// right at that moment - on a system switch to dark with active
// darkPaper, the sheet automatically goes dark too.
if (prefersDark) {
  prefersDark.addEventListener("change", () => {
    if (!loaded()) return;
    if (theme() === "auto") applyChrome();
  });
}

// Language: follow system language changes live, as long as the user
// is on "auto". The `languagechange` event fires on locale change in
// the browser/OS. Rare, but it costs us nothing.
if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    if (!loaded()) return;
    if (language() === "auto") applyLanguage("auto");
  });
}

// If another module import needs the UI before settings.load()
// has finished (e.g. WebDisclaimerBanner reads navigator language before
// the boot promise), seed the system language as the default.
// settings.load() may then overwrite that with the persisted preference.
if (typeof document !== "undefined") {
  applyResolvedLanguage(detectSystemLanguage());
}
