// Regression tests for the inline script title (components/Script/
// TitleInput.tsx): drafts must survive keyboard transitions that remove
// the input without a blur (⌘⇧F swap, ⌘[ navigation), commits must be
// serialized against the last acknowledged title, and nothing commits
// twice.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { Show, createSignal } from "solid-js";
import { flushAll } from "@agentz/kit/lib";
import { TitleInput } from "../TitleInput";

afterEach(() => {
  cleanup();
});

function input(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector("input");
  if (!el) throw new Error("no input");
  return el;
}

function type(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("TitleInput", () => {
  it("retains a failed teardown draft until a later global flush saves it", async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error("offline"));
    const { container, unmount } = render(() => (
      <TitleInput scriptId="failed-title" title="Old" focusFor={null} onCommit={onCommit} />
    ));
    type(input(container), "Unsaved title");
    unmount();
    await tick();
    expect(await flushAll()).toEqual({ ok: false, failed: ["title:failed-title"], contentFailed: ["title:failed-title"] });
    onCommit.mockResolvedValue(undefined);
    expect(await flushAll()).toEqual({ ok: true, failed: [], contentFailed: [] });
    expect(onCommit).toHaveBeenLastCalledWith("Unsaved title", "failed-title");
    const calls = onCommit.mock.calls.length;
    await flushAll();
    expect(onCommit).toHaveBeenCalledTimes(calls);
  });

  it("commits a pending draft when unmounted without a blur", async () => {
    const onCommit = vi.fn(async () => {});
    const [shown, setShown] = createSignal(true);
    const { container } = render(() =>
      <Show when={shown()}>
        <TitleInput scriptId="s1" title="Old" focusFor={null} onCommit={onCommit} />
      </Show>
    );
    type(input(container), "New title");
    setShown(false); // e.g. ⌘⇧F swaps the top bar for the focus title
    await tick();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("New title", "s1");
  });

  it("flushAll awaits the rename (navigation path)", async () => {
    let finish!: () => void;
    const onCommit = vi.fn(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    const { container } = render(() => (
      <TitleInput scriptId="s1" title="Old" focusFor={null} onCommit={onCommit} />
    ));
    type(input(container), "Renamed");
    let done = false;
    const p = flushAll(60_000).then(() => {
      done = true;
    });
    await tick();
    expect(onCommit).toHaveBeenCalledWith("Renamed", "s1");
    expect(done).toBe(false);
    finish();
    await p;
    expect(done).toBe(true);
  });

  it("doesn't commit twice for blur + unmount + flush", async () => {
    const onCommit = vi.fn(async () => {});
    const [shown, setShown] = createSignal(true);
    const { container } = render(() =>
      <Show when={shown()}>
        <TitleInput scriptId="s1" title="Old" focusFor={null} onCommit={onCommit} />
      </Show>
    );
    const el = input(container);
    el.focus();
    type(el, "Once");
    el.blur();
    await flushAll(60_000);
    setShown(false);
    await tick();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("writes a revert to the stored title made while a rename is in flight", async () => {
    const calls: string[] = [];
    const gates: Array<() => void> = [];
    const onCommit = vi.fn(
      (v: string) =>
        new Promise<void>((r) => {
          calls.push(v);
          gates.push(r);
        }),
    );
    // props.title stays "Old" until the parent refetches - stale on purpose.
    const { container } = render(() => (
      <TitleInput scriptId="s1" title="Old" focusFor={null} onCommit={onCommit} />
    ));
    const el = input(container);
    el.focus();
    type(el, "A");
    el.blur(); // rename to A in flight
    await tick();
    el.focus();
    type(el, "Old");
    el.blur(); // back to the original before A is acknowledged
    await tick();
    expect(calls).toEqual(["A"]);
    gates.shift()?.();
    await tick();
    expect(calls).toEqual(["A", "Old"]);
    gates.shift()?.();
    await flushAll(60_000);
  });

  it("commits the draft to the script it was typed for", async () => {
    const onCommit = vi.fn(async () => {});
    const [id, setId] = createSignal("s1");
    const { container } = render(() => (
      <TitleInput scriptId={id()} title={id() === "s1" ? "One" : "Two"} focusFor={null} onCommit={onCommit} />
    ));
    type(input(container), "One renamed");
    setId("s2");
    await tick();
    expect(onCommit).toHaveBeenCalledWith("One renamed", "s1");
    expect(input(container).value).toBe("Two");
  });
});
