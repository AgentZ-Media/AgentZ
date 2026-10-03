// Character registry cleanup: pure helpers, the paged usage scan, the SQL
// find/prune path (incl. the guard against a save racing the delete) and
// the debounced automatic pass.
//
// The SQL tests run against a tiny fake DbConnection that understands
// exactly the statements involved (no SQLite engine in the test
// environment); its LIKE emulation follows SQLite's rules for `%`, `_`
// and `ESCAPE '\'`, case-insensitive for ASCII.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeCharsMeta } from "../characterColors";
import {
  characterUsageBus,
  dropsCharacterNames,
  findUnusedCharacterNames,
  metaNameLikePattern,
  namesInCharsMeta,
  pruneUnusedCharacterNames,
  scanUsedCharacterNames,
  unusedRegistryNames,
} from "../characterUsage";
import {
  AUTO_PRUNE_BOOT_DELAY_MS,
  AUTO_PRUNE_DEBOUNCE_MS,
  runCharacterPrune,
  startCharacterAutoPrune,
} from "../characterAutoPrune";
import { getPlatformAdapter, setPlatformAdapter, type DbConnection, type PlatformAdapter } from "../platform";
import { getStorageAdapter, setStorageAdapter, type StorageAdapter } from "../storage";
import "../api";

const meta = (...names: string[]) => serializeCharsMeta(names.map((name) => ({ name, color: "#e0791f" })));

function sqlLike(value: string, pattern: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (ch === "%") re += "[\\s\\S]*";
    else if (ch === "_") re += "[\\s\\S]";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i").test(value);
}

interface FakeState {
  scripts: { id: string; characters_meta: string }[];
  registry: string[];
  /** Runs once after the last scan page was served (simulates a save). */
  afterScan?: () => void;
}

function fakeDb(state: FakeState) {
  const pageCalls: (string | null)[] = [];
  const db: DbConnection = {
    async select<T>(query: string, params: unknown[] = []): Promise<T> {
      const q = query.replace(/\s+/g, " ").trim();
      if (q === "SELECT name FROM character_colors") {
        return state.registry.map((name) => ({ name })) as T;
      }
      if (q.startsWith("SELECT id, characters_meta FROM scripts")) {
        const after = q.includes("WHERE id >") ? String(params[0]) : null;
        const limit = Number(after === null ? params[0] : params[1]);
        pageCalls.push(after);
        const sorted = [...state.scripts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const page = sorted.filter((r) => after === null || r.id > after).slice(0, limit);
        if (page.length < limit && state.afterScan) {
          const fn = state.afterScan;
          state.afterScan = undefined;
          // Copy first: the page handed out reflects the state before the save.
          const snapshot = page.map((r) => ({ ...r }));
          fn();
          return snapshot as T;
        }
        return page.map((r) => ({ ...r })) as T;
      }
      throw new Error(`unexpected select: ${q}`);
    },
    async execute(query: string, params: unknown[] = []) {
      const q = query.replace(/\s+/g, " ").trim();
      if (q.startsWith("DELETE FROM character_colors WHERE name = $1")) {
        expect(q).toContain("ESCAPE '\\'");
        const [name, pattern] = params as [string, string];
        const stillUsed = state.scripts.some((r) => sqlLike(r.characters_meta, pattern));
        if (stillUsed || !state.registry.includes(name)) return { rowsAffected: 0 };
        state.registry = state.registry.filter((n) => n !== name);
        return { rowsAffected: 1 };
      }
      throw new Error(`unexpected execute: ${q}`);
    },
  };
  return { db, pageCalls };
}

const originalPlatform = (() => {
  try {
    return getPlatformAdapter();
  } catch {
    return null;
  }
})();
const originalStorage = getStorageAdapter();

afterEach(() => {
  if (originalPlatform) setPlatformAdapter(originalPlatform);
  setStorageAdapter(originalStorage);
});

function usePlatform(db: DbConnection) {
  setPlatformAdapter({ getDb: async () => db } as unknown as PlatformAdapter);
}

describe("helpers", () => {
  it("reads uppercased names from characters_meta and tolerates junk", () => {
    expect(namesInCharsMeta(meta("Bob", "ALICE"))).toEqual(["BOB", "ALICE"]);
    expect(namesInCharsMeta("not json")).toEqual([]);
    expect(namesInCharsMeta('{"name":"X"}')).toEqual([]);
    expect(namesInCharsMeta('[{"name":"  "},{"color":"#fff"},{"name":"eve"}]')).toEqual(["EVE"]);
  });

  it("detects dropped names case-insensitively", () => {
    const c = (name: string) => ({ name, color: "#e0791f" });
    expect(dropsCharacterNames([c("BOB")], [c("bob")])).toBe(false);
    expect(dropsCharacterNames([c("BOB"), c("EVE")], [c("BOB")])).toBe(true);
    expect(dropsCharacterNames([], [c("BOB")])).toBe(false);
    expect(dropsCharacterNames([c("BO")], [c("BOB")])).toBe(true);
  });

  it("lists unused registry names, optionally restricted", () => {
    const used = new Set(["BOB"]);
    expect(unusedRegistryNames(["EVE", "BOB", "B"], used)).toEqual(["B", "EVE"]);
    expect(unusedRegistryNames(["EVE", "BOB", "B"], used, ["eve", "bob"])).toEqual(["EVE"]);
  });

  it("builds an exact, escaped LIKE pattern for a meta entry", () => {
    expect(metaNameLikePattern("bob")).toBe('%"name":"BOB"%');
    expect(metaNameLikePattern("A_B%")).toBe('%"name":"A\\_B\\%"%');
    const p = metaNameLikePattern("A_B");
    expect(sqlLike(meta("A_B"), p)).toBe(true);
    expect(sqlLike(meta("AXB"), p)).toBe(false);
    // The "name" key itself must not count as a use of a character NAME.
    expect(sqlLike(meta("BOB"), metaNameLikePattern("NAME"))).toBe(false);
  });
});

describe("scanUsedCharacterNames", () => {
  it("pages by id until a short page and collects every name", async () => {
    const rows = [
      { id: "a", characters_meta: meta("BOB") },
      { id: "b", characters_meta: meta("EVE", "bob") },
      { id: "c", characters_meta: "[]" },
      { id: "d", characters_meta: meta("MAX") },
      { id: "e", characters_meta: "broken" },
    ];
    const calls: (string | null)[] = [];
    const used = await scanUsedCharacterNames(async (after, size) => {
      calls.push(after);
      return rows.filter((r) => after === null || r.id > after).slice(0, size);
    }, 2);
    expect([...used].sort()).toEqual(["BOB", "EVE", "MAX"]);
    expect(calls).toEqual([null, "b", "d"]);
  });
});

describe("SQL find / prune", () => {
  it("finds names no script uses (trash counts as stored)", async () => {
    const state: FakeState = {
      registry: ["BOB", "ALICE", "B", "BO", "NAME"],
      scripts: [
        { id: "1", characters_meta: meta("BOB") },
        // A trashed script is still a stored script.
        { id: "2", characters_meta: meta("ALICE") },
      ],
    };
    usePlatform(fakeDb(state).db);
    expect(await findUnusedCharacterNames()).toEqual(["B", "BO", "NAME"]);
  });

  it("deletes only unused names, restricted to `only`, and bumps the registry", async () => {
    const state: FakeState = {
      registry: ["BOB", "B", "BO"],
      scripts: [{ id: "1", characters_meta: meta("BOB") }],
    };
    usePlatform(fakeDb(state).db);
    const before = characterUsageBus.registryVersion();
    expect(await pruneUnusedCharacterNames(["B", "BOB"])).toEqual(["B"]);
    expect(state.registry).toEqual(["BOB", "BO"]);
    expect(characterUsageBus.registryVersion()).toBe(before + 1);
    expect(await pruneUnusedCharacterNames()).toEqual(["BO"]);
    expect(state.registry).toEqual(["BOB"]);
    expect(await pruneUnusedCharacterNames([])).toEqual([]);
  });

  it("keeps a name a save re-added between scan and delete", async () => {
    const state: FakeState = {
      registry: ["BOB", "EVE", "OLD"],
      scripts: [{ id: "1", characters_meta: meta("BOB") }],
    };
    state.afterScan = () => {
      state.scripts[0].characters_meta = meta("BOB", "EVE");
    };
    usePlatform(fakeDb(state).db);
    expect(await pruneUnusedCharacterNames()).toEqual(["OLD"]);
    expect(state.registry).toEqual(["BOB", "EVE"]);
  });

  it("does not touch the scripts table when the registry is empty", async () => {
    const state: FakeState = { registry: [], scripts: [{ id: "1", characters_meta: meta("BOB") }] };
    const fake = fakeDb(state);
    usePlatform(fake.db);
    expect(await findUnusedCharacterNames()).toEqual([]);
    expect(fake.pageCalls).toEqual([]);
  });
});

describe("automatic cleanup", () => {
  let prune: ReturnType<typeof vi.fn>;
  let stop: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    prune = vi.fn().mockResolvedValue(["B"]);
    setStorageAdapter({ pruneUnusedCharacterNames: prune } as unknown as StorageAdapter);
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
  });

  it("debounces drop signals into one pass", async () => {
    stop = startCharacterAutoPrune(() => true);
    characterUsageBus.notifyNamesDropped();
    await vi.advanceTimersByTimeAsync(AUTO_PRUNE_DEBOUNCE_MS - 100);
    characterUsageBus.notifyNamesDropped();
    characterUsageBus.notifyNamesDropped();
    await vi.advanceTimersByTimeAsync(AUTO_PRUNE_DEBOUNCE_MS - 100);
    expect(prune).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(prune).toHaveBeenCalledTimes(1);
    expect(prune).toHaveBeenCalledWith();
  });

  it("schedules a catch-up pass after boot when enabled", async () => {
    stop = startCharacterAutoPrune(() => true);
    await vi.advanceTimersByTimeAsync(AUTO_PRUNE_BOOT_DELAY_MS);
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the setting is off", async () => {
    let enabled = false;
    stop = startCharacterAutoPrune(() => enabled);
    characterUsageBus.notifyNamesDropped();
    await vi.advanceTimersByTimeAsync(AUTO_PRUNE_BOOT_DELAY_MS * 2);
    expect(prune).not.toHaveBeenCalled();
    expect(await runCharacterPrune()).toEqual([]);
    enabled = true;
    expect(await runCharacterPrune()).toEqual(["B"]);
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it("stop cancels a pending pass", async () => {
    stop = startCharacterAutoPrune(() => true);
    characterUsageBus.notifyNamesDropped();
    stop();
    stop = null;
    await vi.advanceTimersByTimeAsync(AUTO_PRUNE_BOOT_DELAY_MS * 2);
    expect(prune).not.toHaveBeenCalled();
  });
});
