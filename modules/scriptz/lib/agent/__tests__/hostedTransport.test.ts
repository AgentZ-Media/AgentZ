import { describe, expect, it } from "vitest";
import { TransportError, hostedTransport } from "../openrouter/transport";
import { AGENT_NOT_ENABLED } from "../types";

function backend(status: number, body: unknown, signedIn = true) {
  const paths: string[] = [];
  const transport = hostedTransport({
    signedIn: () => signedIn,
    fetch: async (path) => {
      paths.push(path);
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    },
  });
  return { transport, paths };
}

describe("hosted transport", () => {
  it("is ready with the account and model the backend names", async () => {
    const { transport, paths } = backend(200, { email: "a@b.de", model: { id: "m", label: "Modell" }, checkModel: { id: "c", label: "Prüfmodell" } });
    expect(await transport.check()).toEqual({ state: { state: "ready", account: "a@b.de" }, model: { id: "m", label: "Modell" }, checkModel: { id: "c", label: "Prüfmodell" } });
    expect(paths).toEqual(["/ai/status"]);
  });

  it("runs fact checks on the chat model when the backend names no check model", async () => {
    const { transport } = backend(200, { email: "a@b.de", model: { id: "m", label: "Modell" } });
    expect(await transport.check()).toMatchObject({ model: { id: "m" }, checkModel: null });
  });

  it("reports an account the backend has not opened the agent to", async () => {
    const { transport } = backend(403, { error: "not_enabled" });
    expect(await transport.check()).toEqual({ state: { state: "error", message: AGENT_NOT_ENABLED }, model: null, checkModel: null });
    const turn = transport.complete({ messages: [] }, new AbortController().signal);
    await expect(turn).rejects.toBeInstanceOf(TransportError);
    await expect(turn).rejects.toMatchObject({ message: AGENT_NOT_ENABLED, status: 403 });
  });

  it("asks nothing while signed out", async () => {
    const { transport, paths } = backend(200, {}, false);
    expect(await transport.check()).toEqual({ state: { state: "logged-out" }, model: null, checkModel: null });
    expect(paths).toEqual([]);
  });
});
