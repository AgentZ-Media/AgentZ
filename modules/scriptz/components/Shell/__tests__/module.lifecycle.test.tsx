import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "@agentz/kit/platform";
import type { TestStorage as CompleteTestStorage } from "../../../test/storage";

// Keep the actual boot, migration, stores, resource fetchers and buses. Only
// leaf UI is replaced so editor/PDF/dialog setup cannot obscure lifecycle I/O.
vi.mock("../../Library/ScriptsPage", () => ({ ScriptsPage: () => <div data-testid="library" /> }));
vi.mock("../../Library/TrashPage", () => ({ TrashPage: () => null }));
vi.mock("../../Script/ScriptScreen", () => ({ ScriptScreen: () => null }));
vi.mock("../../Script/StageToast", () => ({ StageUndoToast: () => null }));
vi.mock("../../Ideas/IdeasPage", () => ({ IdeasPage: () => null }));
vi.mock("../../Ideas/QuickCapture", () => ({ QuickCapture: () => null }));
vi.mock("../../Export/ExportDialog", () => ({ ExportDialog: () => null }));
vi.mock("../../Onboarding/Onboarding", () => ({
  Onboarding: () => null,
  ONBOARDING_KEY: "onboarding_completed_v1",
}));
vi.mock("../Sidebar", () => ({ Sidebar: () => null, SidebarFooter: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const ONBOARDING = "onboarding_completed_v1";
const MIGRATION = "migration.legacy_blocks_v1";

function testStorage() {
  return {
    getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
    setSetting: vi.fn(async () => {}),
    getAppState: vi.fn(async (key: string): Promise<string | null> => {
      if (key === "welcome_seeded_v3" || key === MIGRATION) return "1";
      return null;
    }),
    setAppState: vi.fn(async () => {}),
    backfillRuntimeStats: vi.fn(async () => {}),
    listIdeas: vi.fn(async () => []),
    loadDailyStats: vi.fn(async () => ({
      wordsToday: 0, wordsThisWeek: 0, streakDays: 0,
      dailyWords: Array(365).fill(0), activeDays: 0, totalWords: 0,
    })),
    listScripts: vi.fn(async () => []),
    listFolders: vi.fn(async () => []),
  };
}

type TestStorage = ReturnType<typeof testStorage>;

async function loadShell(storage: TestStorage) {
  const { setTestStorage } = await import("../../../test/storage");
  // Any unexpected operation fails instead of being silently accepted by a
  // general mock adapter, while methods under test stay individually observable.
  setTestStorage(new Proxy(storage, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected storage operation: ${String(key)}`);
    },
  }) as unknown as CompleteTestStorage);
  const { SuiteShell } = await import("@agentz/kit/shell");
  const { scriptzModule } = await import("../../../module");
  const platform = { platform: "linux", getVersion: async () => "test" } as PlatformAdapter;
  const AppShell = () => <SuiteShell module={scriptzModule} platform={platform} />;
  const { uiStore } = await import("../../../stores/ui");
  const { ideasBus } = await import("../../../lib/ideasBus");
  const { dailyStatsBus } = await import("../../../lib/dailyStatsBus");
  const { scriptsBus } = await import("../../../lib/scriptsBus");
  const { foldersBus } = await import("../../../lib/foldersBus");
  return { AppShell, uiStore, ideasBus, dailyStatsBus, scriptsBus, foldersBus };
}

function expectNoDataLoads(storage: TestStorage) {
  expect(storage.listIdeas).not.toHaveBeenCalled();
  expect(storage.loadDailyStats).not.toHaveBeenCalled();
  expect(storage.listScripts).not.toHaveBeenCalled();
  expect(storage.listFolders).not.toHaveBeenCalled();
}

async function settleBoot() {
  // Boot has a finite chain of Promise.all, migration and onboarding awaits.
  // Draining it avoids using a real timeout for assertions about absent work.
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ScriptZ module lifecycle", () => {
  it("loads data and opens onboarding only after settings and migration finish", async () => {
    const settings = deferred<string | null>();
    const migration = deferred<string | null>();
    const storage = testStorage();
    storage.getSetting.mockImplementation(async (key) => key === "theme" ? settings.promise : null);
    const normalRead = storage.getAppState.getMockImplementation()!;
    storage.getAppState.mockImplementation((key) => key === MIGRATION ? migration.promise : normalRead(key));
    const { AppShell, uiStore } = await loadShell(storage);
    const onboarding = vi.spyOn((await import("@agentz/kit/stores")).shellUi, "openOnboarding");
    const view = render(() => <AppShell />);
    await settleBoot();
    expectNoDataLoads(storage);
    expect(storage.getAppState).not.toHaveBeenCalledWith(MIGRATION);
    expect(onboarding).not.toHaveBeenCalled();
    expect(view.queryByTestId("library")).toBeNull();

    settings.resolve(null);
    await waitFor(() => expect(storage.getAppState).toHaveBeenCalledWith(MIGRATION));
    expectNoDataLoads(storage);
    expect(onboarding).not.toHaveBeenCalled();

    migration.resolve("1");
    await waitFor(() => expect(view.queryByTestId("library")).not.toBeNull());
    expect(storage.listIdeas).toHaveBeenCalledTimes(1);
    expect(storage.loadDailyStats).toHaveBeenCalledTimes(1);
    expect(storage.listScripts).toHaveBeenCalledTimes(1);
    expect(storage.listFolders).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onboarding).toHaveBeenCalledTimes(1));
  });

  it("shows boot failure without starting data resources or onboarding", async () => {
    const storage = testStorage();
    storage.getSetting.mockRejectedValue(new Error("Storage unavailable"));
    const { AppShell, uiStore } = await loadShell(storage);
    const onboarding = vi.spyOn((await import("@agentz/kit/stores")).shellUi, "openOnboarding");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = render(() => <AppShell />);
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("Storage unavailable"));
    expectNoDataLoads(storage);
    expect(onboarding).not.toHaveBeenCalled();
    expect(storage.getAppState).not.toHaveBeenCalledWith(ONBOARDING);
    expect(error).toHaveBeenCalled();
  });

  it.each(["settings", "migration"] as const)("does not resume an unmounted shell waiting for %s", async (pendingStep) => {
    const pending = deferred<string | null>();
    const storage = testStorage();
    if (pendingStep === "settings") {
      storage.getSetting.mockImplementation(async (key) => key === "theme" ? pending.promise : null);
    } else {
      const normalRead = storage.getAppState.getMockImplementation()!;
      storage.getAppState.mockImplementation((key) => key === MIGRATION ? pending.promise : normalRead(key));
    }
    const { AppShell, uiStore } = await loadShell(storage);
    const onboarding = vi.spyOn((await import("@agentz/kit/stores")).shellUi, "openOnboarding");
    const view = render(() => <AppShell />);
    await settleBoot();
    if (pendingStep === "migration") expect(storage.getAppState).toHaveBeenCalledWith(MIGRATION);
    view.unmount();
    pending.resolve("1");
    await settleBoot();
    expectNoDataLoads(storage);
    expect(onboarding).not.toHaveBeenCalled();
    expect(storage.getAppState).not.toHaveBeenCalledWith(ONBOARDING);
  });

  it.each(["ui.layout", "library.view"] as const)(
    "keeps the remounted shell's %s when an old boot read finishes late",
    async (key) => {
      const oldRead = deferred<string | null>();
      const storage = testStorage();
      const normalRead = storage.getAppState.getMockImplementation()!;
      const previous = key === "ui.layout"
        ? { sidebar: true, inspector: true, timeline: false }
        : { grouping: "stage", sort: "updated", collapsed: ["shot", "online"] };
      const current = key === "ui.layout"
        ? { sidebar: false, inspector: false, timeline: true }
        : { grouping: "folder", sort: "title", collapsed: ["writing"] };
      let reads = 0;
      storage.getAppState.mockImplementation((requestedKey) => {
        if (requestedKey !== key) return normalRead(requestedKey);
        reads += 1;
        return reads === 1 ? oldRead.promise : Promise.resolve(JSON.stringify(current));
      });
      const { AppShell, uiStore } = await loadShell(storage);
      const { libraryPrefs } = await import("../../Library/prefs");
      const readState = () => key === "ui.layout"
        ? { sidebar: uiStore.sidebarOpen(), inspector: uiStore.inspectorOpen(), timeline: uiStore.timelineOpen() }
        : { grouping: libraryPrefs.grouping(), sort: libraryPrefs.sort(), collapsed: [...libraryPrefs.collapsed()] };

      const first = render(() => <AppShell />);
      await settleBoot();
      expect(reads).toBe(1);
      expectNoDataLoads(storage);
      first.unmount();
      const second = render(() => <AppShell />);
      await waitFor(() => expect(second.queryByTestId("library")).not.toBeNull());
      expect(reads).toBe(2);
      expect(readState()).toEqual(current);

      oldRead.resolve(JSON.stringify(previous));
      await settleBoot();
      expect(readState()).toEqual(current);
      // Resolving the abandoned boot must not restart the shared resources.
      expect(storage.listIdeas).toHaveBeenCalledTimes(1);
      expect(storage.loadDailyStats).toHaveBeenCalledTimes(1);
      expect(storage.listScripts).toHaveBeenCalledTimes(1);
      expect(storage.listFolders).toHaveBeenCalledTimes(1);
    },
  );

  it("does not open onboarding when its flag resolves after unmount", async () => {
    const pending = deferred<string | null>();
    const storage = testStorage();
    const normalRead = storage.getAppState.getMockImplementation()!;
    storage.getAppState.mockImplementation((key) => key === ONBOARDING ? pending.promise : normalRead(key));
    const { AppShell, uiStore } = await loadShell(storage);
    const onboarding = vi.spyOn((await import("@agentz/kit/stores")).shellUi, "openOnboarding");
    const view = render(() => <AppShell />);
    await waitFor(() => expect(storage.getAppState).toHaveBeenCalledWith(ONBOARDING));
    expect(view.queryByTestId("library")).not.toBeNull();
    view.unmount();
    pending.resolve(null);
    await settleBoot();
    expect(onboarding).not.toHaveBeenCalled();
    expect(uiStore.onboardingOpen()).toBe(false);
  });

  it("stops subscriptions on cleanup and refetches once per event after remount", async () => {
    const storage = testStorage();
    const { AppShell, ideasBus, dailyStatsBus, scriptsBus, foldersBus } = await loadShell(storage);
    const addWindow = vi.spyOn(window, "addEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const addDocument = vi.spyOn(document, "addEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const first = render(() => <AppShell />);
    await waitFor(() => expect(storage.listIdeas).toHaveBeenCalledTimes(1));
    first.unmount();
    ideasBus.bump(); dailyStatsBus.bump(); scriptsBus.bump(); foldersBus.bump();
    await settleBoot();
    expect(storage.listIdeas).toHaveBeenCalledTimes(1);
    expect(storage.loadDailyStats).toHaveBeenCalledTimes(1);
    expect(storage.listScripts).toHaveBeenCalledTimes(1);
    expect(storage.listFolders).toHaveBeenCalledTimes(1);
    for (const [name, listener] of addWindow.mock.calls) {
      if (name === "keydown" || name === "languagechange") {
        expect(removeWindow).toHaveBeenCalledWith(name, listener);
      }
    }
    for (const [name, listener] of addDocument.mock.calls) {
      if (name === "visibilitychange") expect(removeDocument).toHaveBeenCalledWith(name, listener);
    }

    const second = render(() => <AppShell />);
    await waitFor(() => expect(storage.listIdeas).toHaveBeenCalledTimes(2));
    ideasBus.bump(); dailyStatsBus.bump(); scriptsBus.bump();
    await settleBoot();
    expect(storage.listIdeas).toHaveBeenCalledTimes(3);
    expect(storage.loadDailyStats).toHaveBeenCalledTimes(3);
    expect(storage.listScripts).toHaveBeenCalledTimes(3);
    expect(storage.listFolders).toHaveBeenCalledTimes(3);
    second.unmount();
    ideasBus.bump(); dailyStatsBus.bump(); scriptsBus.bump();
    await settleBoot();
    expect(storage.listIdeas).toHaveBeenCalledTimes(3);
    expect(storage.listScripts).toHaveBeenCalledTimes(3);
  });
});
