// Regression tests for the "von / bis" length range fields
// (components/Settings/sections/parts.tsx): saving one bound must never
// overwrite what the user types into the other one meanwhile.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { Show, createSignal } from "solid-js";
import { flushAll } from "../../../lib/saveFlush";
import { RangeFields } from "../sections/parts";

afterEach(() => {
  cleanup();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

function fields(container: HTMLElement): [HTMLInputElement, HTMLInputElement] {
  const list = container.querySelectorAll("input");
  return [list[0] as HTMLInputElement, list[1] as HTMLInputElement];
}

function type(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

describe("RangeFields", () => {
  it("keeps typing in the other field while the first bound saves", async () => {
    const gates: Array<() => void> = [];
    const commits: Array<[number | null, number | null]> = [];
    // Mirrors the global settings: the store updates synchronously, the
    // write completes later.
    const [min, setMin] = createSignal<number | null>(30);
    const [max, setMax] = createSignal<number | null>(60);
    const onCommit = vi.fn(async (a: number | null, b: number | null) => {
      commits.push([a, b]);
      setMin(a);
      setMax(b);
      await new Promise<void>((r) => gates.push(r));
    });
    const { container } = render(() => (
      <RangeFields label="Range" minSec={min()} maxSec={max()} onCommit={onCommit} />
    ));
    const [minEl, maxEl] = fields(container);

    minEl.focus();
    type(minEl, "40");
    // Tab: blur min (commit starts), focus max, start typing.
    minEl.blur();
    maxEl.focus();
    await tick();
    expect(commits).toEqual([[40, 60]]);
    type(maxEl, "1:30");

    gates.shift()?.(); // first save completes
    await tick();
    // Min is canonicalized, max keeps the new input.
    expect(minEl.value).toBe("0:40");
    expect(maxEl.value).toBe("1:30");

    maxEl.blur();
    await tick();
    expect(commits).toEqual([
      [40, 60],
      [40, 90],
    ]);
    gates.shift()?.();
    await flushAll(60_000);
    expect(maxEl.value).toBe("1:30");
  });

  it("serializes commits and diffs against the last acknowledged pair", async () => {
    const gates: Array<() => void> = [];
    const commits: Array<[number | null, number | null]> = [];
    // Folder variant: props only refresh after a reload (stay stale here).
    const onCommit = vi.fn(async (a: number | null, b: number | null) => {
      commits.push([a, b]);
      await new Promise<void>((r) => gates.push(r));
    });
    const { container } = render(() => (
      <RangeFields label="Range" minSec={30} maxSec={60} onCommit={onCommit} />
    ));
    const [minEl] = fields(container);
    minEl.focus();
    type(minEl, "0:40");
    minEl.blur();
    await tick();
    // Revert to the original while the first save is in flight.
    minEl.focus();
    type(minEl, "0:30");
    minEl.blur();
    await tick();
    expect(commits).toEqual([[40, 60]]);
    gates.shift()?.();
    await tick();
    expect(commits).toEqual([
      [40, 60],
      [30, 60],
    ]);
    gates.shift()?.();
    await flushAll(60_000);
  });

  it("commits a valid pending pair when the dialog closes without a blur", async () => {
    const onCommit = vi.fn(async () => {});
    const [shown, setShown] = createSignal(true);
    const { container } = render(() => (
      <Show when={shown()}>
        <RangeFields label="Range" minSec={null} maxSec={null} onCommit={onCommit} />
      </Show>
    ));
    const [, maxEl] = fields(container);
    type(maxEl, "45");
    setShown(false);
    await tick();
    expect(onCommit).toHaveBeenCalledWith(null, 45);
  });
});
