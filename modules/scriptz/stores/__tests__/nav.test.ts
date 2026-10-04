// Regression tests for the navigation store (stores/nav.ts): rapid
// Back/Forward while a save flush is pending must never step past either
// end of the history.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestStorage, setTestStorage, type TestStorage } from "../../test/storage";
import "../../lib/api";
import { registerFlusher } from "@agentz/kit/lib";
import { navStore, startNavRuntime } from "../nav";

const originalAdapter = getTestStorage();
let stopNav: () => void;

beforeAll(() => {
  setTestStorage(
    new Proxy({} as TestStorage, {
      get() {
        return vi.fn().mockResolvedValue(null);
      },
    }),
  );
  stopNav = startNavRuntime();
});

afterAll(() => {
  stopNav();
  setTestStorage(originalAdapter);
});

/** Holds every flushAll() until `open()` - like a slow editor save. */
function slowFlush() {
  let open!: () => void;
  const gate = new Promise<void>((r) => {
    open = r;
  });
  const unregister = registerFlusher(() => gate);
  return {
    open: () => {
      open();
      unregister();
    },
  };
}

describe("navStore history", () => {
  it("applies navigation in order and keeps routes defined", async () => {
    await navStore.openScript("a");
    await navStore.openScript("b");
    await navStore.openScript("c");
    expect(navStore.activeScriptId()).toBe("c");
    expect(navStore.canBack()).toBe(true);
    expect(navStore.canForward()).toBe(false);
  });

  it("rapid Back presses during a pending flush stop at the first entry", async () => {
    const slow = slowFlush();
    // History: scripts, a, b, c (index 3). Five presses, all accepted
    // because none applied yet.
    const presses = Array.from({ length: 5 }, () => navStore.back());
    slow.open();
    await Promise.all(presses);
    const r = navStore.route();
    expect(r).toBeDefined();
    expect(r.kind).toBe("scripts");
    expect(navStore.canBack()).toBe(false);
    expect(navStore.canForward()).toBe(true);
  });

  it("rapid Forward presses during a pending flush stop at the last entry", async () => {
    const slow = slowFlush();
    const presses = Array.from({ length: 6 }, () => navStore.forward());
    slow.open();
    await Promise.all(presses);
    expect(navStore.activeScriptId()).toBe("c");
    expect(navStore.canForward()).toBe(false);
  });

  it("Back then go() during a pending flush apply in request order", async () => {
    const slow = slowFlush();
    const a = navStore.back(); // -> b
    const b = navStore.openIdeas(); // pushes after b, drops c
    slow.open();
    await Promise.all([a, b]);
    expect(navStore.route().kind).toBe("ideas");
    expect(navStore.canForward()).toBe(false);
    await navStore.back();
    expect(navStore.activeScriptId()).toBe("b");
  });

  it("reconcile keeps the index inside a shortened history", async () => {
    // History now: scripts, a, b, ideas; on b after the previous test.
    navStore.reconcile(new Set(["a"]));
    // The deferred reconcile step (leave the dead script) applies first,
    // then Back steps from the last entry of [scripts, a, ideas].
    await navStore.back();
    expect(navStore.activeScriptId()).toBe("a");
    expect(navStore.canForward()).toBe(true);
  });
});

describe("navStore recent", () => {
  it("keeps enough history to fill a tall sidebar, newest first", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `r${i}`);
    for (const id of ids) await navStore.openScript(id, id.toUpperCase());
    const recent = navStore.recent().map((r) => r.scriptId);
    expect(recent).toHaveLength(50);
    expect(recent.slice(0, 3)).toEqual(["r59", "r58", "r57"]);
    expect(navStore.recent()[0]?.title).toBe("R59");
  });
});
