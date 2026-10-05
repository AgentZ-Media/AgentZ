import { createSignal } from "solid-js";
import { getKvStore, type KvStore } from "@agentz/kit/platform";
import { createLayoutStore, createStatePersistence, shellUi } from "@agentz/kit/stores";
import { settingsStore } from "./settings";
import { agentUi } from "./agentUi";

/**
 * UI state of the shell: which panels are visible and which
 * dialog is open. Every dialog is parameterless and reads its open state
 * from here, so the shell only mounts them once and any component (sidebar,
 * command palette, keyboard handler) can open them.
 */

const LAYOUT_KEY = "ui.layout";
const SECTIONS_KEY = "sidebar.sections";
const FOCUS_KEY = (scriptId: string) => `script.${scriptId}.focus_mode`;

export type SettingsSection =
  | "appearance"
  | "writing"
  | "library"
  | "folders"
  | "characters"
  | "shortcuts"
  | "updates"
  | "about";

// ---- panels (persisted) ----
const layout = createLayoutStore({
  key: LAYOUT_KEY,
  defaults: { sidebar: true, inspector: true, timeline: false },
  decode(value) {
    const parsed = value as Record<string, unknown>;
    const result: Partial<{ sidebar: boolean; inspector: boolean; timeline: boolean }> = {};
    for (const key of ["sidebar", "inspector", "timeline"] as const) {
      if (typeof parsed?.[key] === "boolean") result[key] = parsed[key];
    }
    return result;
  },
});
const sidebarOpen = shellUi.sidebarOpen;
const inspectorOpen = () => layout.state().inspector;
const timelineOpen = () => layout.state().timeline;

// ---- sidebar sections: collapsed flags (persisted, default expanded) ----
export type SidebarSection = "pipeline" | "folders";
const [collapsedSections, setCollapsedSections] = createSignal<Record<SidebarSection, boolean>>({
  pipeline: false,
  folders: false,
});

// ---- focus mode (per script override, like before) ----
const [focusMode, setFocusMode] = createSignal(false);
const focusOverride = new Map<string, boolean>();

// ---- dialogs (session only) ----
const [captureOpen, setCaptureOpen] = createSignal(false);
/** Open "new script" dialog: undefined = closed, else its preset folder. */
const [newScriptFolder, setNewScriptFolder] = createSignal<string | null | undefined>(undefined);
const [exportScriptId, setExportScriptId] = createSignal<string | null>(null);
const [activityOpen, setActivityOpen] = createSignal(false);

// ---- ideas page: pending "select + reveal this idea" request ----
const [ideaToReveal, setIdeaToReveal] = createSignal<string | null>(null);

type UiRuntime = {
  kv: KvStore;
  active: boolean;
  focusWrites: Map<string, ReturnType<typeof createStatePersistence>>;
  sectionsWrite: ReturnType<typeof createStatePersistence>;
  stop(): void;
};
let runtime: UiRuntime | undefined;
export function startUiRuntime(kv = getKvStore()): () => void {
  if (runtime?.active) return runtime.stop;
  const stopLayout = layout.start(kv);
  const unbind = shellUi.setSidebarPersistence((sidebar) => layout.update({ sidebar }));
  focusOverride.clear(); setFocusMode(false);
  setCaptureOpen(false); setNewScriptFolder(undefined); setExportScriptId(null); setActivityOpen(false); setIdeaToReveal(null);
  setCollapsedSections({ pipeline: false, folders: false });
  const current: UiRuntime = {
    active: true, kv, focusWrites: new Map(), sectionsWrite: createStatePersistence(kv, SECTIONS_KEY),
    stop() {
      if (!current.active) return;
      current.active = false; unbind(); stopLayout(); current.sectionsWrite.dispose();
      for (const write of current.focusWrites.values()) write.dispose();
      if (runtime === current) runtime = undefined;
    },
  };
  runtime = current;
  return current.stop;
}
/** Reads may start the runtime (setup always does so first). */
function ensureRuntime(): UiRuntime {
  if (!runtime) startUiRuntime();
  return runtime!;
}
/** Writes never start a runtime: after teardown they stay in memory instead
 *  of persisting defaults through a runtime that is never stopped. */
function activeRuntime(): UiRuntime | undefined {
  return runtime?.active ? runtime : undefined;
}

export const uiStore = {
  // panels
  sidebarOpen,
  inspectorOpen,
  timelineOpen,
  toggleSidebar() {
    shellUi.toggleSidebar();
  },
  toggleInspector() {
    layout.update({ inspector: !inspectorOpen() });
  },
  toggleTimeline() {
    layout.update({ timeline: !timelineOpen() });
  },
  setTimelineOpen(v: boolean) {
    layout.update({ timeline: v });
  },

  // sidebar sections
  isSectionCollapsed: (section: SidebarSection) => collapsedSections()[section],
  toggleSection(section: SidebarSection) {
    const next = { ...collapsedSections(), [section]: !collapsedSections()[section] };
    setCollapsedSections(next);
    activeRuntime()?.sectionsWrite.schedule(JSON.stringify(next));
  },

  // focus mode
  focusMode,
  /** Apply the focus mode for a freshly opened script: manual per-script
   *  choice wins, otherwise the global default from the settings. */
  async applyFocusForScript(scriptId: string, isActive: () => boolean = () => true) {
    if (!isActive()) return;
    const current = ensureRuntime();
    const cached = focusOverride.get(scriptId);
    if (cached !== undefined) {
      setFocusMode(cached);
      return;
    }
    setFocusMode(settingsStore.focusModeDefault());
    try {
      const raw = await current.kv.getAppState(FOCUS_KEY(scriptId));
      if (!current.active || !isActive()) return;
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
    const current = activeRuntime();
    const next = !focusMode();
    setFocusMode(next);
    if (scriptId) focusOverride.set(scriptId, next);
    if (scriptId && current) {
      const key = FOCUS_KEY(scriptId);
      let write = current.focusWrites.get(key);
      if (!write) { write = createStatePersistence(current.kv, key); current.focusWrites.set(key, write); }
      write.schedule(next ? "1" : "0");
    }
  },
  /** Leaving the editor always ends focus mode (lists never dim). */
  clearFocus() {
    setFocusMode(false);
  },

  // dialogs
  paletteOpen: shellUi.paletteOpen,
  openPalette: shellUi.openPalette,
  closePalette: shellUi.closePalette,

  captureOpen,
  openCapture: () => setCaptureOpen(true),
  closeCapture: () => setCaptureOpen(false),

  newScriptOpen: () => newScriptFolder() !== undefined,
  /** Folder the dialog starts with (null = no folder). */
  newScriptFolder: () => newScriptFolder() ?? null,
  openNewScript: (folderId: string | null) => setNewScriptFolder(folderId),
  closeNewScript: () => setNewScriptFolder(undefined),

  settingsOpen: shellUi.settingsOpen,
  settingsSection: shellUi.settingsSection,
  openSettings: shellUi.openSettings,
  closeSettings: shellUi.closeSettings,
  setSettingsSection: shellUi.setSettingsSection,

  exportScriptId,
  openExport: (scriptId: string) => setExportScriptId(scriptId),
  closeExport: () => setExportScriptId(null),

  onboardingOpen: shellUi.onboardingOpen,
  openOnboarding: shellUi.openOnboarding,
  closeOnboarding: shellUi.closeOnboarding,

  activityOpen,
  openActivity: () => setActivityOpen(true),
  closeActivity: () => setActivityOpen(false),

  /** Idea the ideas page should select and scroll into view (command
   *  palette, links). The page consumes it via `takeIdeaReveal()` as soon
   *  as it is mounted, clearing filters / expanding groups as needed. */
  ideaToReveal,
  revealIdea: (id: string) => setIdeaToReveal(id),
  takeIdeaReveal(): string | null {
    const id = ideaToReveal();
    if (id !== null) setIdeaToReveal(null);
    return id;
  },

  /** True while any modal dialog is open (global shortcuts back off). */
  anyDialogOpen: () =>
    shellUi.paletteOpen() ||
    captureOpen() ||
    newScriptFolder() !== undefined ||
    shellUi.settingsOpen() ||
    exportScriptId() !== null ||
    shellUi.onboardingOpen() ||
    activityOpen() ||
    agentUi.anyDialogOpen(),

  async load(isActive: () => boolean = () => true) {
    const current = ensureRuntime();
    await layout.load(() => current.active && isActive());
    if (current.active && isActive()) shellUi.setSidebarOpenSilently(layout.state().sidebar);
  },
  /** Collapsed sidebar sections (own key, read once at boot). */
  async loadSidebarSections(isActive: () => boolean = () => true) {
    const current = ensureRuntime();
    try {
      const raw = await current.kv.getAppState(SECTIONS_KEY);
      if (!raw || !current.active || !isActive()) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      setCollapsedSections({ pipeline: parsed.pipeline === true, folders: parsed.folders === true });
    } catch {
      /* expanded by default */
    }
  },
};
