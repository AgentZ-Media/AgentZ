import { describe, expect, it, vi } from "vitest";
import { startDesktopLifecycle, type LifecyclePorts } from "../lib/lifecycle";
import { createEditingLock } from "../lib/editingLock";

function setup(flush: LifecyclePorts["flush"]) {
  let close: (event: { preventDefault(): void }) => void = () => {};
  let exit: (id: number) => void = () => {};
  let menu: (action: string) => void = () => {};
  const lock = createEditingLock(document.createElement("div"));
  const cleanup = vi.fn();
  const ports: LifecyclePorts = {
    listenClose: async (handler) => { close = handler; return cleanup; },
    listenExit: async (handler) => { exit = handler; return cleanup; },
    listenMenu: async (handler) => { menu = handler; return cleanup; },
    ready: vi.fn(async () => {}), finishExit: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}), flush, lockEditing: lock.acquire,
    editingLocked: lock.locked, openSettings: vi.fn(), failed: vi.fn(),
  };
  return { ports, lock, cleanup, close: () => { const preventDefault = vi.fn(); close({ preventDefault }); return preventDefault; }, exit: (id: number) => exit(id), menu: (action: string) => menu(action) };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("native lifecycle", () => {
  it("prevents every duplicate close while one flush is running", async () => {
    let saved!: (value: { ok: boolean; failed: string[] }) => void;
    const flush = vi.fn(() => new Promise<{ ok: boolean; failed: string[] }>((resolve) => { saved = resolve; }));
    const state = setup(flush);
    const stop = await startDesktopLifecycle(state.ports);
    expect(state.close()).toHaveBeenCalledOnce();
    expect(state.close()).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
    expect(state.ports.destroy).not.toHaveBeenCalled();
    saved({ ok: true, failed: [] }); await tick();
    expect(state.ports.destroy).toHaveBeenCalledOnce();
    expect(state.lock.locked()).toBe(false);
    stop(); expect(state.cleanup).toHaveBeenCalledTimes(3);
  });
  it("keeps failed saves editable, refuses quit, and allows a later retry", async () => {
    const flush = vi.fn().mockResolvedValueOnce({ ok: false, failed: ["editor"] }).mockResolvedValue({ ok: true, failed: [] });
    const state = setup(flush);
    const stop = await startDesktopLifecycle(state.ports);
    state.exit(5); await tick();
    expect(state.ports.finishExit).toHaveBeenCalledWith(5, false);
    expect(state.ports.failed).toHaveBeenCalledOnce();
    expect(state.lock.locked()).toBe(false);
    state.exit(6); await tick();
    expect(state.ports.finishExit).toHaveBeenCalledWith(6, true);
    stop();
  });
  it("merges quit during close into the same saved native exit", async () => {
    let saved!: (value: { ok: boolean; failed: string[] }) => void;
    const state = setup(() => new Promise((resolve) => { saved = resolve; }));
    const stop = await startDesktopLifecycle(state.ports);
    state.close(); state.exit(7);
    saved({ ok: true, failed: [] }); await tick();
    expect(state.ports.finishExit).toHaveBeenCalledWith(7, true);
    expect(state.ports.destroy).not.toHaveBeenCalled();
    stop();
  });
  it("refuses close/quit during update installation and uses the same Settings controls", async () => {
    const flush = vi.fn(async () => ({ ok: true, failed: [] }));
    const state = setup(flush);
    const stop = await startDesktopLifecycle(state.ports);
    state.menu("about"); expect(state.ports.openSettings).toHaveBeenCalledWith("about");
    const unlock = state.lock.acquire();
    state.close(); state.exit(8); state.menu("settings"); await tick();
    expect(flush).not.toHaveBeenCalled();
    expect(state.ports.finishExit).toHaveBeenCalledWith(8, false);
    expect(state.ports.openSettings).toHaveBeenCalledTimes(1);
    unlock(); stop();
  });
  it("removes a late listener after the host is disposed during registration", async () => {
    const state = setup(async () => ({ ok: true, failed: [] }));
    const controller = new AbortController();
    let finish!: (cleanup: () => void) => void;
    state.ports.listenClose = () => new Promise((resolve) => { finish = resolve; });
    const started = startDesktopLifecycle(state.ports, controller.signal);
    controller.abort(); finish(state.cleanup); await started;
    expect(state.cleanup).toHaveBeenCalledOnce();
    expect(state.ports.ready).not.toHaveBeenCalled();
  });
  it("cleans up earlier listeners if registration fails", async () => {
    const state = setup(async () => ({ ok: true, failed: [] }));
    state.ports.listenMenu = async () => { throw new Error("native unavailable"); };
    await expect(startDesktopLifecycle(state.ports)).rejects.toThrow("native unavailable");
    expect(state.cleanup).toHaveBeenCalledTimes(2);
    expect(state.ports.ready).not.toHaveBeenCalled();
  });
});

it("freezes existing editors and portal shortcuts until the final lock is released", () => {
  const root = document.createElement("div");
  const input = document.createElement("input"); root.append(input); document.body.append(root); input.focus();
  const lock = createEditingLock(root);
  const first = lock.acquire(); const second = lock.acquire();
  expect(document.activeElement).not.toBe(input);
  expect(root.inert).toBe(true);
  const key = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
  document.dispatchEvent(key); expect(key.defaultPrevented).toBe(true);
  first(); first(); expect(root.inert).toBe(true);
  second(); expect(root.inert).not.toBe(true);
  root.remove();
});
