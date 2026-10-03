// These literals describe already-shipped databases. Keep them independent
// of production constants so an extraction cannot silently rename a key.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptzApiStorage } from "../storage";

const SETTINGS = {
  theme: "dark",
  highlighting_default: "1",
  update_check_enabled: "0",
  hourly_update_check: "0",
  quick_mode_auto_enable: "1",
  dialog_wpm: "175",
  focus_mode_default: "1",
  show_writing_stats: "0",
  dark_paper: "1",
  language: "en",
  length_min_default_sec: "30",
  length_max_default_sec: "90",
  prune_unused_characters: "1",
};

function memory() {
  const settings = new Map<string, string>(Object.entries(SETTINGS));
  const state = new Map<string, string>();
  const getSetting = vi.fn(async (key: string) => settings.get(key) ?? null);
  const setSetting = vi.fn(async (key: string, value: string) => { settings.set(key, value); });
  const getAppState = vi.fn(async (key: string) => state.get(key) ?? null);
  const setAppState = vi.fn(async (key: string, value: string) => { state.set(key, value); });
  const listScripts = vi.fn(async () => []);
  const createScript = vi.fn(async () => ({ id: "welcome-id" }));
  const getScript = vi.fn(async (id: string) => ({ id, title: "Welcome", content_json: '{"root":{"children":[]}}' }));
  const operations = { getSetting, setSetting, getAppState, setAppState, listScripts, createScript, getScript };
  const adapter = new Proxy(operations as unknown as ScriptzApiStorage, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (value !== undefined) return value;
      throw new Error(`Unexpected storage call in persistence contract: ${String(prop)}`);
    },
  });
  return { ...operations, adapter, settings, state };
}

let db: ReturnType<typeof memory>;
let stop: (() => void) | undefined;

beforeEach(async () => {
  vi.resetModules();
  db = memory();
  // Import the facade before installing the fake; this also works before
  // the old automatic SQL-adapter registration is removed in Phase 4.0.
  await import("../api");
  const { setStorageAdapter } = await import("../storage");
  setStorageAdapter(db.adapter);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
});

describe("persisted settings contract", () => {
  it("reads all thirteen existing keys and restores their stored values", async () => {
    const { settingsStore: s, startSettingsRuntime } = await import("../../stores/settings");
    stop = startSettingsRuntime();
    await s.load();
    expect(db.getSetting.mock.calls.map(([key]) => key).sort()).toEqual(Object.keys(SETTINGS).sort());
    expect({
      theme: s.theme(), highlighting: s.highlightingDefault(), updates: s.updateCheckEnabled(),
      hourly: s.hourlyUpdateCheck(), quick: s.quickModeAutoEnable(), wpm: s.dialogWpm(),
      focus: s.focusModeDefault(), stats: s.showWritingStats(), paper: s.darkPaper(),
      language: s.language(), min: s.lengthMinDefaultSec(), max: s.lengthMaxDefaultSec(),
      prune: s.pruneUnusedCharacters(),
    }).toEqual({
      theme: "dark", highlighting: true, updates: false, hourly: false, quick: true,
      wpm: 175, focus: true, stats: false, paper: true, language: "en", min: 30, max: 90, prune: true,
    });
  });

  it("writes the same key names and string encodings, including unset bounds", async () => {
    const { settingsStore: s, startSettingsRuntime } = await import("../../stores/settings");
    stop = startSettingsRuntime();
    await Promise.all([
      s.setTheme("auto"), s.setHighlightingDefault(false), s.setUpdateCheckEnabled(true),
      s.setHourlyUpdateCheck(true), s.setQuickModeAutoEnable(false), s.setDialogWpm(180.6),
      s.setFocusModeDefault(false), s.setShowWritingStats(true), s.setDarkPaper(false),
      s.setLanguage("de"), s.setLengthMinDefaultSec(null), s.setLengthMaxDefaultSec(95.7),
      s.setPruneUnusedCharacters(false),
    ]);
    expect(Object.fromEntries(db.setSetting.mock.calls)).toEqual({
      theme: "auto", highlighting_default: "0", update_check_enabled: "1", hourly_update_check: "1",
      quick_mode_auto_enable: "0", dialog_wpm: "181", focus_mode_default: "0", show_writing_stats: "1",
      dark_paper: "0", language: "de", length_min_default_sec: "", length_max_default_sec: "96",
      prune_unused_characters: "0",
    });
  });
});

describe("persisted app_state contract", () => {
  it("restores and writes nav.state without persisting session history", async () => {
    const existing = {
      route: { kind: "scripts", status: "ready", folderId: "folder-a" },
      recent: [{ scriptId: "script-a", title: "Alpha", openedAt: 1234 }],
    };
    db.state.set("nav.state", JSON.stringify(existing));
    const { navStore, startNavRuntime } = await import("../../stores/nav");
    stop = startNavRuntime();
    await navStore.load();
    expect(navStore.route()).toEqual(existing.route);
    expect(navStore.recent()).toEqual(existing.recent);
    expect(navStore.canBack()).toBe(false);
    await navStore.openIdeas("folder-b");
    // The contract includes the debounced write; wait for the observable
    // adapter call instead of reaching into the private timer.
    await vi.waitFor(() => expect(db.setAppState).toHaveBeenCalled());
    expect(db.getAppState.mock.calls).toEqual([["nav.state"]]);
    expect([...db.state.keys()]).toEqual(["nav.state"]);
    expect(JSON.parse(db.state.get("nav.state")!)).toEqual({
      route: { kind: "ideas", folderId: "folder-b" }, recent: existing.recent,
    });
  });

  it("migrates old open_tabs records to nav.state while preserving the old row", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const old = JSON.stringify({ tabs: [
      { scriptId: "first", scriptTitle: "First" }, {}, { scriptId: "second" },
    ] });
    db.state.set("open_tabs", old);
    const { navStore, startNavRuntime } = await import("../../stores/nav");
    stop = startNavRuntime();
    await navStore.load();
    await vi.waitFor(() => expect(db.state.has("nav.state")).toBe(true));
    expect(db.getAppState.mock.calls).toEqual([["nav.state"], ["open_tabs"]]);
    expect(db.state.get("open_tabs")).toBe(old);
    expect(JSON.parse(db.state.get("nav.state")!)).toEqual({
      route: { kind: "scripts" },
      recent: [
        { scriptId: "second", title: "", openedAt: 1700000000000 },
        { scriptId: "first", title: "First", openedAt: 1699999999999 },
      ],
    });
  });

  it("restores layout and per-script focus, then writes their existing shapes", async () => {
    db.state.set("ui.layout", '{"sidebar":false,"inspector":false,"timeline":true}');
    db.state.set("script.script-a.focus_mode", "1");
    const { uiStore } = await import("../../stores/ui");
    await uiStore.load();
    expect([uiStore.sidebarOpen(), uiStore.inspectorOpen(), uiStore.timelineOpen()]).toEqual([false, false, true]);
    uiStore.toggleSidebar();
    expect(JSON.parse(db.state.get("ui.layout")!)).toEqual({ sidebar: true, inspector: false, timeline: true });
    await uiStore.applyFocusForScript("script-a");
    expect(uiStore.focusMode()).toBe(true);
    uiStore.toggleFocus("script-a");
    expect(db.state.get("script.script-a.focus_mode")).toBe("0");
    uiStore.toggleFocus("script-a");
    expect(db.state.get("script.script-a.focus_mode")).toBe("1");
    expect(db.getAppState.mock.calls).toEqual([["ui.layout"], ["script.script-a.focus_mode"]]);
  });

  it("round-trips library.view grouping, sort and collapsed group IDs", async () => {
    db.state.set("library.view", '{"grouping":"folder","sort":"title","collapsed":["folder-a","online"]}');
    const { libraryPrefs } = await import("../../components/Library/prefs");
    await libraryPrefs.load();
    expect(libraryPrefs.grouping()).toBe("folder");
    expect(libraryPrefs.sort()).toBe("title");
    expect([...libraryPrefs.collapsed()]).toEqual(["folder-a", "online"]);
    libraryPrefs.setGrouping("none");
    libraryPrefs.setSort("created");
    libraryPrefs.toggleCollapsed("online");
    expect(db.getAppState.mock.calls).toEqual([["library.view"]]);
    expect(JSON.parse(db.state.get("library.view")!)).toEqual({ grouping: "none", sort: "created", collapsed: ["folder-a"] });
  });

  it("keeps welcome seed and ID markers, and never seeds again after completion", async () => {
    const { ensureWelcomeContent, getWelcomeScript } = await import("../welcome");
    await ensureWelcomeContent();
    expect(db.createScript).toHaveBeenCalledOnce();
    expect(db.setAppState.mock.calls).toEqual([["welcome_script_id_v1", "welcome-id"], ["welcome_seeded_v3", "1"]]);
    expect(await getWelcomeScript()).toEqual({ id: "welcome-id", title: "Welcome" });
    await ensureWelcomeContent();
    expect(db.createScript).toHaveBeenCalledOnce();
    expect(db.getAppState.mock.calls).toEqual([["welcome_seeded_v3"], ["welcome_script_id_v1"], ["welcome_seeded_v3"]]);
  });

  it("keeps the legacy-block migration marker as decimal Unix milliseconds", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000123);
    const { migrateLegacyBlocksOnce } = await import("../legacyBlocksMigration");
    await migrateLegacyBlocksOnce();
    expect(db.setAppState.mock.calls).toEqual([["migration.legacy_blocks_v1", "1700000000123"]]);
    await migrateLegacyBlocksOnce();
    expect(db.listScripts).toHaveBeenCalledOnce();
    expect(db.getAppState.mock.calls).toEqual([["migration.legacy_blocks_v1"], ["migration.legacy_blocks_v1"]]);
  });
});
