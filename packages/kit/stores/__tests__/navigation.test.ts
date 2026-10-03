import { afterEach, describe, expect, it, vi } from "vitest";
import { createNavStore } from "../nav";
import { createStatePersistence } from "../persistedState";
import { createLayoutStore } from "../layout";
import { flushAll, registerFlusher } from "../../lib";
import type { KvStore } from "../../platform";

const cleanups: Array<() => void> = [];
afterEach(async () => {
  cleanups.splice(0).reverse().forEach((stop) => stop());
  await flushAll();
});
const memory = (): KvStore & { state: Map<string, string> } => {
  const state = new Map<string, string>();
  return { state, getSetting: async () => null, setSetting: async () => {},
    getAppState: async (key) => state.get(key) ?? null,
    setAppState: async (key, value) => { state.set(key, value); } };
};
const navigation = (onFlushFailed = vi.fn()) => createNavStore({
  home: "home", encode: (route: string) => JSON.stringify({ route }),
  read: async (kv) => { const raw = await kv.getAppState("nav.state"); return raw ? JSON.parse(raw).route : undefined; },
  onFlushFailed,
});

describe("generic navigation persistence", () => {
  it("retains the current route when a pending save fails", async () => {
    const blocked = vi.fn();
    const nav = navigation(blocked);
    cleanups.push(nav.start(memory()));
    const unregister = registerFlusher(() => ({ ok: false }), "failed-editor");
    await nav.go("next");
    expect(nav.route()).toBe("home");
    expect(blocked).toHaveBeenCalledOnce();
    unregister();
    await nav.go("next");
    expect(nav.route()).toBe("next");
  });

  it("navigates despite failed UI state such as a layout write", async () => {
    const blocked = vi.fn();
    const nav = navigation(blocked);
    cleanups.push(nav.start(memory()));
    const unregister = registerFlusher(() => ({ ok: false }), "failed-layout", "state");
    await nav.go("next");
    expect(nav.route()).toBe("next");
    expect(blocked).not.toHaveBeenCalled();
    unregister();
  });

  it("retries a frozen disposed payload on its original adapter", async () => {
    const old = memory();
    const next = memory();
    let broken = true;
    const write = old.setAppState;
    old.setAppState = async (key, value) => { if (broken) throw new Error("offline"); await write(key, value); };
    const nav = navigation();
    const stop = nav.start(old);
    await nav.go("old-route");
    stop();
    expect((await flushAll()).ok).toBe(false);
    cleanups.push(nav.start(next));
    expect(nav.route()).toBe("home");
    broken = false;
    expect((await flushAll()).ok).toBe(true);
    expect(JSON.parse(old.state.get("nav.state")!)).toEqual({ route: "old-route" });
    expect(next.state.size).toBe(0);
    await nav.go("new-route");
    await flushAll();
    expect(JSON.parse(next.state.get("nav.state")!)).toEqual({ route: "new-route" });
  });

  it("ignores an old pending read after a new runtime starts", async () => {
    const old = memory();
    let finish!: (raw: string) => void;
    old.getAppState = () => new Promise((resolve) => { finish = resolve; });
    const nav = navigation();
    const stop = nav.start(old);
    const pending = nav.load();
    stop();
    const next = memory(); next.state.set("nav.state", '{"route":"fresh"}');
    cleanups.push(nav.start(next));
    await nav.load();
    finish('{"route":"stale"}'); await pending;
    expect(nav.route()).toBe("fresh");
  });
});

describe("persistence across same-adapter lifetimes", () => {
  it("never retries an old failed payload over a newer saved value", async () => {
    const kv = memory();
    const write = kv.setAppState;
    let broken = true;
    kv.setAppState = async (key, value) => { if (broken) throw new Error("offline"); await write(key, value); };
    const old = createStatePersistence(kv, "shared");
    old.schedule("old"); old.dispose();
    expect((await flushAll()).ok).toBe(false);
    const next = createStatePersistence(kv, "shared");
    broken = false;
    next.schedule("new");
    await next.flush();
    expect(kv.state.get("shared")).toBe("new");
    expect((await flushAll()).ok).toBe(true);
    expect(kv.state.get("shared")).toBe("new");
    next.dispose();
  });
});

describe("complete-object layout writes", () => {
  it("serializes changes without dropping unrelated fields and preserves failed teardown", async () => {
    const kv = memory();
    const layout = createLayoutStore({ key: "layout", defaults: { sidebar: true, extra: false }, decode: (value) => value as { sidebar: boolean; extra: boolean } });
    const stop = layout.start(kv);
    layout.update({ sidebar: false });
    layout.update({ extra: true });
    stop();
    expect((await flushAll()).ok).toBe(true);
    expect(JSON.parse(kv.state.get("layout")!)).toEqual({ sidebar: false, extra: true });
  });
});
