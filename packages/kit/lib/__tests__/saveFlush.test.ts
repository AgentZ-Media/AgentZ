import { afterEach, describe, expect, it, vi } from "vitest";
import { FlushCoordinator } from "../saveFlush";
import { createSerialSaver } from "../serialSave";

afterEach(() => vi.useRealTimers());

describe("FlushCoordinator", () => {
  it("handles empty passes and unregisters only the matching registration", async () => {
    const coordinator = new FlushCoordinator();
    const fn = vi.fn();
    const unregister = coordinator.register(fn, "one");
    coordinator.register(fn, "two");
    unregister();
    unregister();
    expect(await coordinator.flush()).toEqual({ ok: true, failed: [], contentFailed: [] });
    expect(fn).toHaveBeenCalledOnce();
    expect(await new FlushCoordinator().flush()).toEqual({ ok: true, failed: [], contentFailed: [] });
  });

  it("reports synchronous throws, rejected writes and explicit failure results by name", async () => {
    const coordinator = new FlushCoordinator();
    coordinator.register(() => { throw new Error("read failed"); }, "sync");
    coordinator.register(() => Promise.reject(new Error("write failed")), "async");
    coordinator.register(() => ({ ok: false }), "result");
    coordinator.register(() => ({ ok: true }), "saved");
    expect(await coordinator.flush()).toEqual({ ok: false, failed: ["sync", "async", "result"], contentFailed: ["sync", "async", "result"] });
  });

  it("separates failed UI state from failed content and passes the timeout on", async () => {
    const coordinator = new FlushCoordinator();
    const timeouts: number[] = [];
    coordinator.register(() => ({ ok: false }), "layout", "state");
    coordinator.register((timeoutMs) => { timeouts.push(timeoutMs); return { ok: true }; }, "editor");
    expect(await coordinator.flush(750)).toEqual({ ok: false, failed: ["layout"], contentFailed: [] });
    expect(timeouts).toEqual([750]);
    coordinator.register(() => ({ ok: false }), "title");
    expect(await coordinator.flush()).toEqual({ ok: false, failed: ["layout", "title"], contentFailed: ["title"] });
  });

  it("reports timed-out registrations while allowing late rejection to settle safely", async () => {
    vi.useFakeTimers();
    const coordinator = new FlushCoordinator();
    let reject!: (error: Error) => void;
    coordinator.register(() => new Promise<void>((_, fail) => { reject = fail; }), "slow");
    coordinator.register(() => {}, "fast");
    const pending = coordinator.flush(50);
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    expect(result).toEqual({ ok: false, failed: ["slow"], contentFailed: ["slow"] });
    reject(new Error("late failure"));
    await Promise.resolve();
    expect(result).toEqual({ ok: false, failed: ["slow"], contentFailed: ["slow"] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports failed serial saves and succeeds after retrying their dirty drafts", async () => {
    const coordinator = new FlushCoordinator();
    const write = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("latest");
    const saver = createSerialSaver({ initial: "stored", read: () => "latest", write });
    saver.markDirty();
    coordinator.register(() => saver.flush(), "draft");
    expect(await coordinator.flush()).toEqual({ ok: false, failed: ["draft"], contentFailed: ["draft"] });
    expect(saver.baseline()).toBe("stored");
    expect(await coordinator.flush()).toEqual({ ok: true, failed: [], contentFailed: [] });
    expect(saver.baseline()).toBe("latest");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("runs a fresh pass for concurrent calls so a later edit is also persisted", async () => {
    const coordinator = new FlushCoordinator();
    let finishFirst!: () => void;
    let draft = "first";
    const stored: string[] = [];
    const saver = createSerialSaver({
      initial: "initial", read: () => draft,
      async write(value) {
        if (value === "first") await new Promise<void>((resolve) => { finishFirst = resolve; });
        stored.push(value);
        return value;
      },
    });
    coordinator.register(() => saver.flush(), "draft");
    saver.markDirty();
    const first = coordinator.flush();
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    draft = "second";
    saver.markDirty();
    const second = coordinator.flush();
    finishFirst();
    expect(await first).toEqual({ ok: true, failed: [], contentFailed: [] });
    expect(await second).toEqual({ ok: true, failed: [], contentFailed: [] });
    expect(stored).toEqual(["first", "second"]);
  });
});
