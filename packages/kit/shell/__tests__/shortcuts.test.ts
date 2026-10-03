import { describe, expect, it, vi } from "vitest";
import { createShellShortcuts, createShortcutRegistry } from "../shortcuts";
import type { ShortcutDef } from "../types";

const key = (value: string, init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", {
  key: value, metaKey: true, bubbles: true, cancelable: true, ...init,
});
const definition = (run = vi.fn()): ShortcutDef => ({
  id: "fixture.action", label: () => "Action", group: { id: "app", label: () => "App" },
  keys: ["Mod+I"], contexts: ["shell"], matches: (event) => event.key === "i", run,
});

describe("shortcut registry", () => {
  it("keeps shell actions available inside an editor and consumes one match", () => {
    const run = vi.fn();
    const second = vi.fn();
    const registry = createShortcutRegistry(() => [definition(run), definition(second)], () => "editor");
    const event = key("i");
    registry.handle(event);
    expect(run).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("honors controls that claimed the event, composition, disabled actions and modal ownership", () => {
    const run = vi.fn();
    const event = key("i");
    event.preventDefault();
    const registry = createShortcutRegistry(() => [definition(run)]);
    registry.handle(event);
    registry.handle(key("i", { isComposing: true }));
    createShortcutRegistry(() => [{ ...definition(run), enabled: () => false }]).handle(key("i"));
    createShortcutRegistry(() => [definition(run)], () => "editor", () => true).handle(key("i"));
    expect(run).not.toHaveBeenCalled();
  });

  it("limits editor and dialog handlers to their declared contexts", () => {
    const run = vi.fn();
    const editor = { ...definition(run), contexts: ["editor"] as const };
    createShortcutRegistry(() => [editor], () => "list").handle(key("i"));
    expect(run).not.toHaveBeenCalled();
    createShortcutRegistry(() => [editor], () => "editor").handle(key("i"));
    const dialog = { ...definition(run), contexts: ["dialog"] as const };
    createShortcutRegistry(() => [dialog], () => "editor", () => true).handle(key("i"));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not dispatch documentation-only entries", () => {
    const event = key("i");
    createShortcutRegistry(() => [{ ...definition(), run: undefined }]).handle(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("starts explicitly in bubble phase and removes its listener idempotently", () => {
    const run = vi.fn();
    const registry = createShortcutRegistry(() => [definition(run)]);
    window.dispatchEvent(key("i"));
    expect(run).not.toHaveBeenCalled();
    const stop = registry.start();
    registry.start();
    const input = document.createElement("input");
    document.body.append(input);
    input.addEventListener("keydown", (event) => event.preventDefault());
    input.dispatchEvent(key("i"));
    expect(run).not.toHaveBeenCalled();
    window.dispatchEvent(key("i"));
    expect(run).toHaveBeenCalledOnce();
    stop();
    stop();
    window.dispatchEvent(key("i"));
    expect(run).toHaveBeenCalledOnce();
    input.remove();
  });

  it("reads definitions dynamically and owns only the two common shell actions", () => {
    const shell = { openPalette: vi.fn(), openSettings: vi.fn() };
    let definitions: ShortcutDef[] = [];
    const registry = createShortcutRegistry(() => definitions);
    registry.handle(key("k"));
    definitions = createShellShortcuts(shell);
    registry.handle(key("K"));
    registry.handle(key(","));
    registry.handle(key("k", { altKey: true }));
    registry.handle(key(",", { shiftKey: true }));
    expect(shell.openPalette).toHaveBeenCalledOnce();
    expect(shell.openSettings).toHaveBeenCalledOnce();
    expect(definitions.map((item) => item.id)).toEqual(["shell.palette", "shell.settings"]);
  });
});
