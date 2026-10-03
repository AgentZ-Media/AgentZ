import { afterEach, expect, it, vi } from "vitest";
import { clearToasts, dismissToast, pushToast, toastsSignal } from "../toasts";

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
