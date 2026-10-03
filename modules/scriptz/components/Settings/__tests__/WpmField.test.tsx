// Regression tests for the WPM field (components/Settings/sections/
// SettingsWriting.tsx) and the settings store writes behind it: arrow-key
// steps go through the same serialized saver as typed commits (one write
// at a time, newest value wins) and closing the dialog / window flushes them.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { Show, createSignal } from "solid-js";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import { flushAll } from "@agentz/kit/lib";
import { settingsStore, startSettingsRuntime } from "../../../stores/settings";
import { SettingsWriting } from "../sections/SettingsWriting";

const originalAdapter = getTestStorage();
let stopSettings: () => void;
const writes: Array<[string, string]> = [];
const gates: Array<() => void> = [];
let inFlight = 0;
let maxInFlight = 0;
const stored = new Map<string, string>();

beforeAll(() => {
  const fake: Partial<TestStorage> = {
    setSetting: (key, value) =>
      new Promise<void>((resolve) => {
        writes.push([key, value]);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        gates.push(() => {
          inFlight--;
          stored.set(key, value);
          resolve();
        });
      }),
  };
  setTestStorage(
    new Proxy(fake as TestStorage, {
      get(target, prop: string) {
        return (target as unknown as Record<string, unknown>)[prop] ?? (async () => null);
      },
    }),
  );
  stopSettings = startSettingsRuntime();
});

afterAll(() => {
  stopSettings();
  setTestStorage(originalAdapter);
});

const tick = () => new Promise((r) => setTimeout(r, 0));

async function drain() {
  let done = false;
  const flushed = flushAll(60_000).then(() => {
    done = true;
  });
  while (!done) {
    while (gates.length) gates.shift()?.();
    await tick();
  }
  await flushed;
}

afterEach(async () => {
  cleanup();
  await drain();
  writes.length = 0;
  maxInFlight = 0;
  stored.clear();
});

function key(el: Element, k: string) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}

function renderWriting() {
  const [shown, setShown] = createSignal(true);
  const { container } = render(() => (
    <Show when={shown()}>
      <SettingsWriting onClose={() => {}} />
    </Show>
  ));
  const input = container.querySelector(".num-f input") as HTMLInputElement;
  return { input, close: () => setShown(false) };
}

describe("WPM field", () => {
  it("serializes an arrow step behind a typed commit still in flight", async () => {
    const base = settingsStore.dialogWpm();
    const { input } = renderWriting();
    input.focus();
    input.value = "300";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    key(input, "Enter");
    await tick();
    expect(writes).toEqual([["dialog_wpm", "300"]]);

    key(input, "ArrowUp"); // steps from what the field shows
    expect(input.value).toBe("310");
    await tick();
    // Still only the first write - the step waits for it.
    expect(writes).toHaveLength(1);

    gates.shift()?.();
    await tick();
    await tick();
    expect(writes).toEqual([
      ["dialog_wpm", "300"],
      ["dialog_wpm", "310"],
    ]);
    gates.shift()?.();
    await drain();
    expect(maxInFlight).toBe(1);
    expect(stored.get("dialog_wpm")).toBe("310");
    expect(settingsStore.dialogWpm()).toBe(310);
    expect(base).not.toBe(310);
  });

  it("flushes an arrow step when the dialog closes right away", async () => {
    const { input, close } = renderWriting();
    const start = settingsStore.dialogWpm();
    input.focus();
    key(input, "ArrowDown");
    close(); // before the debounce fired
    let done = false;
    const flushed = flushAll(60_000).then(() => {
      done = true;
    });
    await tick();
    expect(writes).toEqual([["dialog_wpm", String(start - 10)]]);
    expect(done).toBe(false);
    gates.shift()?.();
    await flushed;
    expect(stored.get("dialog_wpm")).toBe(String(start - 10));
  });
});

describe("settings store writes", () => {
  it("land in order, one at a time per key, and flushAll waits for them", async () => {
    const a = settingsStore.setShowWritingStats(false);
    const b = settingsStore.setShowWritingStats(true);
    await tick();
    expect(writes).toEqual([["show_writing_stats", "0"]]);
    let done = false;
    const flushed = flushAll(60_000).then(() => {
      done = true;
    });
    gates.shift()?.();
    await tick();
    expect(writes).toEqual([
      ["show_writing_stats", "0"],
      ["show_writing_stats", "1"],
    ]);
    expect(done).toBe(false);
    gates.shift()?.();
    await Promise.all([a, b, flushed]);
    expect(stored.get("show_writing_stats")).toBe("1");
  });
});
