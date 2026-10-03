import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../CommandPalette";
import type { Command, CommandProvider } from "../types";

const command = (label: string): Command => ({ id: label, label, run: vi.fn() });
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("command palette", () => {
  it("renders every item in repeated groups before and after asynchronous enrichment", async () => {
    const recent = { id: "recent", label: "Recent entries" };
    const actions = { id: "actions", label: "Actions" };
    const initial = [
      ...Array.from({ length: 4 }, (_, index) => ({ ...command(`Recent ${index}`), group: recent })),
      ...Array.from({ length: 8 }, (_, index) => ({ ...command(`Action ${index}`), group: actions })),
    ];
    let resolve!: (items: Command[]) => void;
    const provider: CommandProvider = () => new Promise((done) => { resolve = done; });
    provider.immediate = () => initial;
    render(() => <CommandPalette open onClose={() => {}} commands={provider} />);
    expect(within(screen.getByRole("group", { name: recent.label })).getAllByRole("option").map((row) => row.textContent))
      .toEqual(["Recent 0", "Recent 1", "Recent 2", "Recent 3"]);
    expect(within(screen.getByRole("group", { name: actions.label })).getAllByRole("option").map((row) => row.textContent))
      .toEqual(Array.from({ length: 8 }, (_, index) => `Action ${index}`));
    expect(screen.getAllByRole("option")).toHaveLength(12);
    resolve(initial.map((item) => ({ ...item, label: `${item.label} complete` })));
    await tick();
    expect(screen.getAllByRole("option")).toHaveLength(12);
    expect(within(screen.getByRole("group", { name: recent.label })).getAllByRole("option").map((row) => row.textContent))
      .toEqual(["Recent 0 complete", "Recent 1 complete", "Recent 2 complete", "Recent 3 complete"]);
    const input = screen.getByRole("combobox");
    for (let index = 0; index < 11; index++) fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("Action 7 complete");
    expect(input.getAttribute("aria-activedescendant")).toBe("pal-it-11");
  });

  it("renders local matches immediately and debounces enrichment by 140 ms", async () => {
    vi.useFakeTimers();
    const provider = vi.fn((query: string) => [command(`Complete ${query}`)]) as CommandProvider;
    provider.immediate = (query) => [command(`Local ${query}`)];
    render(() => <CommandPalette open onClose={() => {}} commands={provider} />);
    fireEvent.input(screen.getByRole("combobox"), { target: { value: "plan" } });
    expect(screen.getByText("Local plan")).toBeTruthy();
    expect(provider).toHaveBeenCalledTimes(1); // Initial empty query.
    await vi.advanceTimersByTimeAsync(139);
    expect(screen.queryByText("Complete plan")).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.getByText("Complete plan")).toBeTruthy();
  });

  it("aborts stale searches and ignores their eventual results, including after close", async () => {
    vi.useFakeTimers();
    const requests = new Map<string, { signal: AbortSignal; resolve(result: Command[]): void }>();
    const provider: CommandProvider = (query, signal) => query ? new Promise((resolve) => {
      requests.set(query, { signal, resolve });
    }) : [];
    const [open, setOpen] = createSignal(true);
    render(() => <CommandPalette open={open()} onClose={() => setOpen(false)} commands={provider} />);
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "old" } });
    await vi.advanceTimersByTimeAsync(140);
    fireEvent.input(input, { target: { value: "new" } });
    expect(requests.get("old")!.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(140);
    requests.get("new")!.resolve([command("Current result")]);
    await tick();
    requests.get("old")!.resolve([command("Stale result")]);
    await tick();
    expect(screen.getByText("Current result")).toBeTruthy();
    expect(screen.queryByText("Stale result")).toBeNull();
    fireEvent.input(input, { target: { value: "pending" } });
    await vi.advanceTimersByTimeAsync(140);
    setOpen(false);
    expect(requests.get("pending")!.signal.aborted).toBe(true);
    requests.get("pending")!.resolve([command("After close")]);
    await tick();
    setOpen(true);
    expect(screen.queryByText("After close")).toBeNull();
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
  });

  it("restores focus on Escape and ignores IME key events", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const item = command("Open entry");
    const [open, setOpen] = createSignal(false);
    render(() => <CommandPalette open={open()} onClose={() => setOpen(false)} commands={() => [item]} />);
    setOpen(true);
    await tick();
    const input = screen.getByRole("combobox");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    expect(item.run).not.toHaveBeenCalled();
    expect(open()).toBe(true);
    fireEvent.keyDown(input, { key: "Escape" });
    await tick();
    expect(open()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("runs the arrow-selected command after closing, without reclaiming its focus", async () => {
    const destination = document.createElement("button");
    document.body.append(destination);
    const first = command("First");
    const second = command("Second");
    second.run = vi.fn(() => destination.focus());
    const [open, setOpen] = createSignal(true);
    render(() => <CommandPalette open={open()} onClose={() => setOpen(false)} commands={() => [first, second]} />);
    await tick();
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(open()).toBe(false);
    expect(second.run).not.toHaveBeenCalled();
    await tick();
    expect(second.run).toHaveBeenCalledOnce();
    expect(first.run).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(destination);
  });
});
