import { afterEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown) => void;
const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  channels: [] as Array<{ emit: Handler }>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    constructor(onmessage: Handler) { mocks.channels.push({ emit: onmessage }); }
  },
}));
import { createCodexHost } from "../lib/codexHost";

function emitter() { return mocks.channels[mocks.channels.length - 1]!.emit; }

afterEach(() => { mocks.invoke.mockReset(); mocks.channels.length = 0; });

describe("codex host", () => {
  it("does no native work until called", () => {
    createCodexHost();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.channels).toHaveLength(0);
  });

  it("passes config and channel to codex_start", async () => {
    mocks.invoke.mockResolvedValueOnce(7);
    const process = await createCodexHost().start(["sandbox_mode=read-only"]);
    expect(process.id).toBe(7);
    expect(mocks.invoke).toHaveBeenCalledWith("plugin:agentz-desktop|codex_start", {
      config: ["sandbox_mode=read-only"], onEvent: expect.anything(),
    });
  });

  it("replays lines emitted before the first subscriber, then streams live", async () => {
    mocks.invoke.mockImplementationOnce(async () => {
      // Output can arrive before codex_start resolves.
      emitter()({ type: "stdout", line: "early" });
      return 1;
    });
    const process = await createCodexHost().start();
    emitter()({ type: "stdout", line: "second" });
    emitter()({ type: "stderr", line: "log" });
    const first: string[] = [];
    const later: string[] = [];
    process.onLine((line) => first.push(line));
    process.onLine((line) => later.push(line));
    emitter()({ type: "stdout", line: "live" });
    expect(first).toEqual(["early", "second", "live"]);
    expect(later).toEqual(["live"]);
    const errors: string[] = [];
    const stopErrors = process.onStderr((line) => errors.push(line));
    expect(errors).toEqual(["log"]);
    stopErrors();
    emitter()({ type: "stderr", line: "ignored" });
    expect(errors).toEqual(["log"]);
  });

  it("reports exit once, also to late subscribers, and rejects later sends", async () => {
    mocks.invoke.mockResolvedValueOnce(2);
    const process = await createCodexHost().start();
    const early = vi.fn();
    process.onExit(early);
    emitter()({ type: "exit", code: 0 });
    emitter()({ type: "exit", code: 1 });
    const late = vi.fn();
    process.onExit(late);
    expect(early).toHaveBeenCalledTimes(1);
    expect(early).toHaveBeenCalledWith(0);
    expect(late).toHaveBeenCalledWith(0);
    await expect(process.send("{}")).rejects.toThrow("exited");
  });

  it("writes lines in call order even without awaiting and survives failures", async () => {
    mocks.invoke.mockResolvedValueOnce(3);
    const process = await createCodexHost().start();
    const written: string[] = [];
    let release!: () => void;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command !== "plugin:agentz-desktop|codex_send") return;
      const line = String(args?.line);
      if (line === "a") await slow;
      if (line === "b") throw "pipe closed";
      written.push(line);
    });
    const a = process.send("a");
    const b = process.send("b");
    const c = process.send("c");
    release();
    await a;
    await expect(b).rejects.toThrow("pipe closed");
    await c;
    expect(written).toEqual(["a", "c"]);
  });

  it("stops by session id and wraps native errors", async () => {
    mocks.invoke.mockResolvedValueOnce(4);
    const process = await createCodexHost().start();
    mocks.invoke.mockResolvedValueOnce(undefined);
    await process.stop();
    expect(mocks.invoke).toHaveBeenLastCalledWith("plugin:agentz-desktop|codex_stop", { id: 4 });
    mocks.invoke.mockRejectedValueOnce("Codex CLI not found");
    await expect(createCodexHost().start()).rejects.toThrow("Codex CLI not found");
  });

  it("locates through the native command", async () => {
    mocks.invoke.mockResolvedValueOnce({ path: "/bin/codex", version: "0.160.0" });
    await expect(createCodexHost().locate()).resolves.toEqual({ path: "/bin/codex", version: "0.160.0" });
    expect(mocks.invoke).toHaveBeenCalledWith("plugin:agentz-desktop|codex_locate");
  });
});
