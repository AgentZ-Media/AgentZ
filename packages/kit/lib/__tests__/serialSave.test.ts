// Tests for the serialized "latest draft wins" saver (lib/serialSave.ts).

import { describe, expect, it, vi } from "vitest";
import { createSerialSaver } from "../serialSave";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A string draft + a fake store whose writes complete on demand. */
function harness(initial: string) {
  let draft = initial;
  let stored = initial;
  const gates: Array<ReturnType<typeof deferred<void>>> = [];
  const writes: string[] = [];
  let failNext = false;
  const saver = createSerialSaver<string>({
    initial,
    read: () => draft,
    isClean: (d, b) => d === b,
    async write(d) {
      writes.push(d);
      const gate = deferred<void>();
      gates.push(gate);
      await gate.promise;
      if (failNext) {
        failNext = false;
        throw new Error("boom");
      }
      stored = d;
      return d;
    },
    onError: () => {},
  });
  return {
    saver,
    writes,
    set: (v: string) => {
      draft = v;
    },
    stored: () => stored,
    /** Resolves the oldest open write and lets the queue advance. */
    async release() {
      const g = gates.shift();
      g?.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    failNextWrite() {
      failNext = true;
    },
    openWrites: () => gates.length,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createSerialSaver", () => {
  it("writes a revert to the stored value that happens while a newer write is in flight", async () => {
    const h = harness("A");
    h.set("B");
    h.saver.markDirty();
    const first = h.saver.flush();
    await tick();
    expect(h.writes).toEqual(["B"]);

    // Undo back to A while B is still in flight.
    h.set("A");
    h.saver.markDirty();
    const second = h.saver.flush();

    await h.release(); // B lands
    await tick();
    expect(h.writes).toEqual(["B", "A"]);
    await h.release(); // A lands
    await Promise.all([first, second]);
    expect(h.stored()).toBe("A");
    expect(h.saver.baseline()).toBe("A");
  });

  it("never runs two writes at the same time", async () => {
    const h = harness("A");
    for (const v of ["B", "C", "D"]) {
      h.set(v);
      h.saver.markDirty();
      void h.saver.flush();
      await tick();
    }
    expect(h.openWrites()).toBe(1);
    await h.release();
    await tick();
    expect(h.openWrites()).toBe(1);
    // The queued run read the newest draft when it started.
    expect(h.writes).toEqual(["B", "D"]);
    await h.release();
    await h.saver.flush();
    expect(h.stored()).toBe("D");
  });

  it("flush resolves only after in-flight writes finished", async () => {
    const h = harness("A");
    h.set("B");
    h.saver.markDirty();
    void h.saver.flush();
    await tick();
    let done = false;
    const p = h.saver.flush().then(() => {
      done = true;
    });
    await tick();
    expect(done).toBe(false);
    await h.release();
    await p;
    expect(done).toBe(true);
  });

  it("skips clean drafts and coalesces into a queued run", async () => {
    const h = harness("A");
    await h.saver.flush();
    expect(h.writes).toEqual([]);
    h.set("B");
    h.saver.markDirty();
    void h.saver.flush();
    h.saver.markDirty();
    void h.saver.flush();
    await tick();
    expect(h.writes).toEqual(["B"]);
    await h.release();
    await h.saver.flush();
    expect(h.writes).toEqual(["B"]);
  });

  it("keeps the old baseline after a failed write and retries on the next flush", async () => {
    const h = harness("A");
    h.set("B");
    h.saver.markDirty();
    h.failNextWrite();
    const p = h.saver.flush();
    await tick();
    await h.release();
    expect(await p).toEqual({ ok: false });
    expect(h.saver.baseline()).toBe("A");
    expect(h.saver.idle()).toBe(false);
    const retry = h.saver.flush();
    await tick();
    await h.release();
    expect(await retry).toEqual({ ok: true });
    expect(h.stored()).toBe("B");
    expect(h.saver.idle()).toBe(true);
  });

  it("keeps the queue usable when reading, comparing or reporting an error throws", async () => {
    let broken = "read";
    const saver = createSerialSaver({
      initial: "A",
      read: () => {
        if (broken === "read") throw new Error("read");
        return "B";
      },
      isClean: (draft, baseline) => {
        if (broken === "compare") throw new Error("compare");
        return draft === baseline;
      },
      write: async (draft) => draft,
      onError: () => { throw new Error("reporter"); },
    });
    saver.markDirty();
    expect(await saver.flush()).toEqual({ ok: false });
    broken = "compare";
    expect(await saver.flush()).toEqual({ ok: false });
    broken = "";
    expect(await saver.flush()).toEqual({ ok: true });
    expect(saver.baseline()).toBe("B");
  });

  it("debounces schedule() and escalates the reason of a coalesced run", async () => {
    vi.useFakeTimers();
    try {
      const reasons: string[] = [];
      let draft = "A";
      const saver = createSerialSaver<string>({
        initial: "A",
        read: () => draft,
        isClean: (d, b) => d === b,
        delayMs: 250,
        async write(d, _b, reason) {
          reasons.push(reason);
          return d;
        },
      });
      draft = "B";
      saver.schedule();
      await vi.advanceTimersByTimeAsync(100);
      draft = "C";
      saver.schedule();
      await vi.advanceTimersByTimeAsync(249);
      expect(reasons).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(reasons).toEqual(["debounce"]);
      draft = "D";
      saver.schedule();
      await saver.flush("teardown");
      expect(reasons).toEqual(["debounce", "teardown"]);
      expect(saver.baseline()).toBe("D");
    } finally {
      vi.useRealTimers();
    }
  });
});
