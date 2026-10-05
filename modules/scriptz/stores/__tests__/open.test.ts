// The sidebar's "Open" list (stores/open.ts): seeding, persistence and the
// rule that closes scripts which reach the last stage.

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushAll } from "@agentz/kit/lib";
import { openStore, startOpenStore } from "../open";

function memoryKv(initial: Record<string, string> = {}) {
  const state = new Map(Object.entries(initial));
  return {
    state,
    getAppState: vi.fn(async (key: string) => state.get(key) ?? null),
    setAppState: vi.fn(async (key: string, value: string) => { state.set(key, value); }),
    getSetting: async () => null,
    setSetting: async () => {},
  };
}

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

async function start(initial: Record<string, string> = {}) {
  const kv = memoryKv(initial);
  stop = startOpenStore(kv);
  return kv;
}

const scripts = (entries: Record<string, string>) =>
  Object.entries(entries).map(([id, status]) => ({ id, status }));

describe("openStore", () => {
  it("seeds a fresh install from the recent scripts and stores its own key", async () => {
    const kv = await start();
    await openStore.load(() => ["a", "b", "c", "d", "e", "f", "g"]);
    expect(openStore.ids()).toEqual(["a", "b", "c", "d", "e"]);
    await flushAll();
    expect(JSON.parse(kv.state.get("nav.open")!)).toEqual({ ids: ["a", "b", "c", "d", "e"] });
  });

  it("restores a stored list, even an empty one, without seeding", async () => {
    await start({ "nav.open": '{"ids":["x","x","y"]}' });
    await openStore.load(() => ["a"]);
    expect(openStore.ids()).toEqual(["x", "y"]);
    stop?.();
    await start({ "nav.open": '{"ids":[]}' });
    await openStore.load(() => ["a"]);
    expect(openStore.ids()).toEqual([]);
  });

  it("adds at the top, keeps the place of open scripts and drops dead ones", async () => {
    const kv = await start({ "nav.open": '{"ids":["a"]}' });
    await openStore.load(() => []);
    openStore.add("b");
    openStore.add("a");
    openStore.add("c");
    expect(openStore.ids()).toEqual(["c", "b", "a"]);
    openStore.reconcile(new Set(["a", "c"]));
    expect(openStore.ids()).toEqual(["c", "a"]);
    await flushAll();
    stop?.();
    stop = startOpenStore(kv);
    await openStore.load(() => []);
    expect(openStore.ids()).toEqual(["c", "a"]);
  });

  it("keeps the 50 newest open scripts when the list reaches its cap", async () => {
    await start();
    for (let i = 0; i < 51; i++) openStore.add(`script-${i}`);
    expect(openStore.ids()).toEqual(Array.from({ length: 50 }, (_, i) => `script-${50 - i}`));
    openStore.add("script-25");
    expect(openStore.ids()).toEqual(Array.from({ length: 50 }, (_, i) => `script-${50 - i}`));
    openStore.remove("script-25");
    openStore.add("script-25");
    expect(openStore.ids()[0]).toBe("script-25");
    expect(openStore.ids()).toHaveLength(50);
  });

  it("closes a script that reaches the last stage unless it is on screen", async () => {
    await start({ "nav.open": '{"ids":["a","b","c"]}' });
    await openStore.load(() => []);
    openStore.syncStatuses(scripts({ a: "writing", b: "writing", c: "writing" }), "online", "a", true);
    openStore.syncStatuses(scripts({ a: "online", b: "online", c: "writing" }), "online", "a", true);
    // b closes right away, a (on screen) stays until the view moves on.
    expect(openStore.ids()).toEqual(["a", "c"]);
    openStore.leave("c");
    expect(openStore.ids()).toEqual(["a", "c"]);
    openStore.leave("a");
    expect(openStore.ids()).toEqual(["c"]);
  });

  it("keeps finished scripts that were reopened by hand and respects the setting", async () => {
    await start({ "nav.open": '{"ids":["a"]}' });
    await openStore.load(() => []);
    openStore.syncStatuses(scripts({ a: "online", b: "writing" }), "online", null, true);
    openStore.syncStatuses(scripts({ a: "online", b: "writing" }), "online", null, true);
    expect(openStore.ids()).toEqual(["a"]);
    openStore.add("b");
    openStore.syncStatuses(scripts({ a: "online", b: "online" }), "online", null, false);
    expect(openStore.ids()).toEqual(["b", "a"]);
  });

  it("brings an automatically closed script back when the change is undone", async () => {
    await start({ "nav.open": '{"ids":["a","b","c"]}' });
    await openStore.load(() => []);
    openStore.syncStatuses(scripts({ a: "writing", b: "ready", c: "writing" }), "online", null, true);
    openStore.syncStatuses(scripts({ a: "writing", b: "online", c: "writing" }), "online", null, true);
    expect(openStore.ids()).toEqual(["a", "c"]);
    openStore.syncStatuses(scripts({ a: "writing", b: "ready", c: "writing" }), "online", null, true);
    expect(openStore.ids()).toEqual(["a", "b", "c"]);
  });

  it("cancels a pending close when the script on screen leaves the last stage again", async () => {
    await start({ "nav.open": '{"ids":["a"]}' });
    await openStore.load(() => []);
    openStore.syncStatuses(scripts({ a: "writing" }), "online", "a", true);
    openStore.syncStatuses(scripts({ a: "online" }), "online", "a", true);
    openStore.syncStatuses(scripts({ a: "writing" }), "online", "a", true);
    openStore.leave("a");
    expect(openStore.ids()).toEqual(["a"]);
  });

  it("keeps the cap when undo reopens a script after another one was added", async () => {
    const kv = await start();
    const initial = Array.from({ length: 50 }, (_, i) => `script-${49 - i}`);
    for (const id of [...initial].reverse()) openStore.add(id);
    const entries = Object.fromEntries(initial.map((id) => [id, "writing"]));
    openStore.syncStatuses(scripts(entries), "online", null, true);
    openStore.syncStatuses(scripts({ ...entries, "script-49": "online" }), "online", null, true);
    openStore.add("new-script");
    openStore.syncStatuses(scripts(entries), "online", null, true);

    const expected = ["script-49", "new-script", ...initial.slice(1, -1)];
    expect(openStore.ids()).toEqual(expected);
    expect(openStore.ids()).toHaveLength(50);
    await flushAll();
    expect(JSON.parse(kv.state.get("nav.open")!)).toEqual({ ids: expected });
  });
});
