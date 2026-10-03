import { createSignal } from "solid-js";
import { api } from "../lib/api";
import { settingsStore } from "./settings";

/**
 * UI state of the Werkbank shell: which panels are visible and which
 * dialog is open. Every dialog is parameterless and reads its open state
 * from here, so the shell only mounts them once and any component (sidebar,
 * command palette, keyboard handler) can open them.
 */

const LAYOUT_KEY = "ui.layout";
const FOCUS_KEY = (scriptId: string) => `script.${scriptId}.focus_mode`;

export type SettingsSection =
  | "appearance"
  | "writing"
  | "folders"
  | "characters"
  | "shortcuts"
  | "studio"
  | "updates"
  | "about";

// ---- panels (persisted) ----
const [sidebarOpen, setSidebarOpen] = createSignal(true);
const [inspectorOpen, setInspectorOpen] = createSignal(true);
const [timelineOpen, setTimelineOpen] = createSignal(false);

// ---- focus mode (per script override, like before) ----
const [focusMode, setFocusMode] = createSignal(false);
const focusOverride = new Map<string, boolean>();

// ---- dialogs (session only) ----
const [paletteOpen, setPaletteOpen] = createSignal(false);
const [captureOpen, setCaptureOpen] = createSignal(false);
const [settingsOpen, setSettingsOpen] = createSignal(false);
const [settingsSection, setSettingsSection] = createSignal<SettingsSection>("appearance");
const [exportScriptId, setExportScriptId] = createSignal<string | null>(null);
const [onboardingOpen, setOnboardingOpen] = createSignal(false);
const [activityOpen, setActivityOpen] = createSignal(false);

function persistLayout() {
  const payload = JSON.stringify({
    sidebar: sidebarOpen(),
    inspector: inspectorOpen(),
    timeline: timelineOpen(),
  });
  void api.setAppState(LAYOUT_KEY, payload).catch(() => {});
}

export const uiStore = {
  // panels
  sidebarOpen,
  inspectorOpen,
  timelineOpen,
  toggleSidebar() {
    setSidebarOpen(!sidebarOpen());
    persistLayout();
  },
  toggleInspector() {
    setInspectorOpen(!inspectorOpen());
    persistLayout();
  },
  toggleTimeline() {
    setTimelineOpen(!timelineOpen());
    persistLayout();
  },
  setTimelineOpen(v: boolean) {
    setTimelineOpen(v);
    persistLayout();
  },

  // focus mode
  focusMode,
  /** Apply the focus mode for a freshly opened script: manual per-script
   *  choice wins, otherwise the global default from the settings. */
  async applyFocusForScript(scriptId: string) {
    const cached = focusOverride.get(scriptId);
    if (cached !== undefined) {
      setFocusMode(cached);
      return;
    }
    setFocusMode(settingsStore.focusModeDefault());
    try {
      const raw = await api.getAppState(FOCUS_KEY(scriptId));
      if (raw === "1" || raw === "0") {
        const v = raw === "1";
        focusOverride.set(scriptId, v);
        setFocusMode(v);
      }
    } catch {
      /* keep default */
    }
  },
  /** ⌘⇧F. Remembers the choice for this script. */
  toggleFocus(scriptId: string | null) {
    const next = !focusMode();
    setFocusMode(next);
    if (scriptId) {
      focusOverride.set(scriptId, next);
      void api.setAppState(FOCUS_KEY(scriptId), next ? "1" : "0").catch(() => {});
    }
  },
  /** Leaving the editor always ends focus mode (lists never dim). */
  clearFocus() {
    setFocusMode(false);
  },

  // dialogs
  paletteOpen,
  openPalette: () => setPaletteOpen(true),
  closePalette: () => setPaletteOpen(false),

  captureOpen,
  openCapture: () => setCaptureOpen(true),
  closeCapture: () => setCaptureOpen(false),

  settingsOpen,
  settingsSection,
  openSettings(section?: SettingsSection) {
    if (section) setSettingsSection(section);
    setSettingsOpen(true);
  },
  closeSettings: () => setSettingsOpen(false),
  setSettingsSection,

  exportScriptId,
  openExport: (scriptId: string) => setExportScriptId(scriptId),
  closeExport: () => setExportScriptId(null),

  onboardingOpen,
  openOnboarding: () => setOnboardingOpen(true),
  closeOnboarding: () => setOnboardingOpen(false),

  activityOpen,
  openActivity: () => setActivityOpen(true),
  closeActivity: () => setActivityOpen(false),

  /** True while any modal dialog is open (global shortcuts back off). */
  anyDialogOpen: () =>
    paletteOpen() ||
    captureOpen() ||
    settingsOpen() ||
    exportScriptId() !== null ||
    onboardingOpen() ||
    activityOpen(),

  async load() {
    try {
      const raw = await api.getAppState(LAYOUT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { sidebar?: boolean; inspector?: boolean; timeline?: boolean };
      if (typeof parsed.sidebar === "boolean") setSidebarOpen(parsed.sidebar);
      if (typeof parsed.inspector === "boolean") setInspectorOpen(parsed.inspector);
      if (typeof parsed.timeline === "boolean") setTimelineOpen(parsed.timeline);
    } catch {
      /* defaults */
    }
  },
};
