import { afterEach, expect, it, vi } from "vitest";
import { clearToasts, dismissToast, pushToast, runToastAction, toastsSignal } from "../toasts";

afterEach(() => { clearToasts(); vi.useRealTimers(); });

it("clears dismissed and remaining notification timers on shell teardown", () => {
  vi.useFakeTimers();
  pushToast("first");
  pushToast("second");
  expect(vi.getTimerCount()).toBe(2);
  dismissToast(toastsSignal()[0].id);
  expect(vi.getTimerCount()).toBe(1);
  clearToasts();
  expect(toastsSignal()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it("runs a toast action once and closes the toast", async () => {
  const run = vi.fn();
  const id = pushToast("moved", "ok", undefined, { action: { label: "Undo", run } });
  expect(toastsSignal()[0].action?.label).toBe("Undo");
  runToastAction(id);
  runToastAction(id);
  await Promise.resolve();
  await Promise.resolve();
  expect(run).toHaveBeenCalledTimes(1);
  expect(toastsSignal()).toEqual([]);
});

it("keeps toasts with an action longer", () => {
  vi.useFakeTimers();
  pushToast("plain");
  pushToast("with action", "ok", undefined, { action: { label: "Undo", run: () => {} } });
  vi.advanceTimersByTime(2500);
  expect(toastsSignal().map((t) => t.text)).toEqual(["with action"]);
  vi.advanceTimersByTime(4000);
  expect(toastsSignal()).toEqual([]);
});

it("merges a repeated plain message and keeps at most four toasts", () => {
  vi.useFakeTimers();
  const first = pushToast("save failed", "error");
  vi.advanceTimersByTime(2000);
  expect(pushToast("save failed", "error")).toBe(first);
  vi.advanceTimersByTime(2000);
  // The repeat restarted the timer.
  expect(toastsSignal().map((t) => t.text)).toEqual(["save failed"]);
  for (const text of ["a", "b", "c", "d"]) pushToast(text);
  expect(toastsSignal().map((t) => t.text)).toEqual(["a", "b", "c", "d"]);
  expect(vi.getTimerCount()).toBe(4);
});
