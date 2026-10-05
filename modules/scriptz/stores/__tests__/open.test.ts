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

  it("adds at the end, keeps the place of open scripts and drops dead ones", async () => {
    await start({ "nav.open": '{"ids":["a"]}' });
    await openStore.load(() => []);
    openStore.add("b");
    openStore.add("a");
    openStore.add("c");
    expect(openStore.ids()).toEqual(["a", "b", "c"]);
    openStore.reconcile(new Set(["a", "c"]));
    expect(openStore.ids()).toEqual(["a", "c"]);
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
    expect(openStore.ids()).toEqual(["a", "b"]);
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
});
