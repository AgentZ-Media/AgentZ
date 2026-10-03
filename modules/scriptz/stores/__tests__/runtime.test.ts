import { afterEach, describe, expect, it, vi } from "vitest";
import { getStorageAdapter, setStorageAdapter, type ScriptzApiStorage } from "../../lib/storage";
import type { DailyStatsSummary, Idea, ScriptSummary } from "../../lib/types";
import { ideasStore, startIdeasStore } from "../ideas";
import { dailyStatsStore, startDailyStatsStore } from "../dailyStats";
import { ideasBus } from "../../lib/ideasBus";
import { dailyStatsBus } from "../../lib/dailyStatsBus";
import { scriptsBus } from "../../lib/scriptsBus";
import { library, startLibraryData } from "../../components/Shell/libraryData";
import { navStore, startNavRuntime } from "../nav";
import { flushAll, registerFlusher } from "@agentz/kit/lib";
import { settingsStore, startSettingsRuntime } from "../settings";

const originalAdapter = getStorageAdapter();
const cleanups: Array<() => void> = [];
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function install(adapter: Partial<ScriptzApiStorage>) {
  setStorageAdapter(adapter as ScriptzApiStorage);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanups.splice(0).reverse().forEach((stop) => stop());
  setStorageAdapter(originalAdapter);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("explicit singleton runtimes", () => {
  it("starts shared caches once, refetches on bus changes and stops subscriptions", async () => {
    const listIdeas = vi.fn().mockResolvedValue([{ id: "idea" }]);
    const loadDailyStats = vi.fn().mockResolvedValue({ wordsToday: 7 });
    install({ listIdeas, loadDailyStats });
    expect(ideasStore.ideas()).toEqual([]);
    expect(dailyStatsStore.stats().wordsToday).toBe(0);
    const stopIdeas = startIdeasStore();
    const stopStats = startDailyStatsStore();
    cleanups.push(stopIdeas, stopStats);
    expect(startIdeasStore()).toBe(stopIdeas);
    expect(startDailyStatsStore()).toBe(stopStats);
    await tick();
    expect(listIdeas).toHaveBeenCalledTimes(1);
    expect(loadDailyStats).toHaveBeenCalledTimes(1);
    expect(ideasStore.ideas.latest[0].id).toBe("idea");
    expect(dailyStatsStore.stats().wordsToday).toBe(7);
    ideasBus.bump();
    dailyStatsBus.bump();
    await tick();
    expect(listIdeas).toHaveBeenCalledTimes(2);
    expect(loadDailyStats).toHaveBeenCalledTimes(2);
    stopIdeas();
    stopStats();
    ideasBus.bump();
    dailyStatsBus.bump();
    await tick();
    expect(listIdeas).toHaveBeenCalledTimes(2);
    expect(loadDailyStats).toHaveBeenCalledTimes(2);
    expect(ideasStore.ideas()).toEqual([]);
    expect(dailyStatsStore.stats().dailyWords).toHaveLength(365);
    cleanups.push(startIdeasStore(), startDailyStatsStore());
    await tick();
    expect(listIdeas).toHaveBeenCalledTimes(3);
    expect(loadDailyStats).toHaveBeenCalledTimes(3);
  });

  it("keeps disposed resource results out of a new runtime", async () => {
    const oldIdeas = deferred<Idea[]>();
    const oldStats = deferred<DailyStatsSummary>();
    install({ listIdeas: () => oldIdeas.promise, loadDailyStats: () => oldStats.promise });
    const stopIdeas = startIdeasStore();
    const stopStats = startDailyStatsStore();
    stopIdeas();
    stopStats();
    install({
      listIdeas: async () => [{ id: "new" }] as Idea[],
      loadDailyStats: async () => ({ wordsToday: 3 }) as DailyStatsSummary,
    });
    cleanups.push(startIdeasStore(), startDailyStatsStore());
    await tick();
    oldIdeas.resolve([{ id: "old" }] as Idea[]);
    oldStats.resolve({ wordsToday: 99 } as DailyStatsSummary);
    await tick();
    expect(ideasStore.ideas()[0].id).toBe("new");
    expect(dailyStatsStore.stats().wordsToday).toBe(3);
  });

  it("resets library readiness and ignores a fetch that finishes after dispose", async () => {
    const pending = deferred<ScriptSummary[]>();
    const listScripts = vi.fn(() => pending.promise);
    const listFolders = vi.fn().mockResolvedValue([]);
    install({ listScripts, listFolders });
    const stop = startLibraryData();
    expect(startLibraryData()).toBe(stop);
    expect(library.loaded()).toBe(false);
    stop();
    pending.resolve([{ id: "stale", status: "writing" }] as ScriptSummary[]);
    await tick();
    expect(library.scripts()).toEqual([]);
    expect(library.loaded()).toBe(false);
    expect(library.scriptsReady()).toBe(false);
    scriptsBus.bump();
    expect(listScripts).toHaveBeenCalledTimes(1);
    cleanups.push(startLibraryData());
    await tick();
    expect(library.loaded()).toBe(true);
    expect(library.scriptsReady()).toBe(true);
    expect(listScripts).toHaveBeenCalledTimes(2);
  });

  it("does not apply settings from a disposed boot", async () => {
    const pending = deferred<string | null>();
    install({ getSetting: () => pending.promise });
    const stop = startSettingsRuntime();
    const load = settingsStore.load();
    stop();
    pending.resolve("dark");
    await load;
    expect(settingsStore.loaded()).toBe(false);
  });

  it("drains buffered navigation when disposed and prevents late route changes", async () => {
    const writes: string[] = [];
    install({ setAppState: async (_key, value) => { writes.push(value); } });
    const stop = startNavRuntime();
    cleanups.push(stop);
    await navStore.openScript("saved-before-stop");
    const pending = deferred<void>();
    const unregister = registerFlusher(() => pending.promise);
    cleanups.push(unregister);
    const change = navStore.openScript("must-not-open");
    await Promise.resolve();
    stop();
    pending.resolve();
    await change;
    unregister();
    await flushAll();
    expect(navStore.activeScriptId()).toBe("saved-before-stop");
    expect(writes.map((value) => JSON.parse(value).route.scriptId)).toEqual(["saved-before-stop"]);
  });


});
