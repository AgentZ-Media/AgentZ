// Own OpenRouter key: the model catalog the user picks from and the chosen
// model reaching OpenRouter. The hosted agent offers only the server's model.

import { describe, expect, it } from "vitest";
import { OpenRouterProvider } from "../openrouter/provider";
import { hostedTransport, keyTransport, parseModels } from "../openrouter/transport";
import { memoryThreads } from "./openrouterFakes";

type Obj = Record<string, unknown>;

const CATALOG = {
  data: [
    { id: "z-ai/zeta", name: "Z.ai: Zeta", supported_parameters: ["tools", "reasoning"], architecture: { output_modalities: ["text"] } },
    { id: "google/gemini-3.8-flash", name: "Google: Gemini 3.8 Flash", supported_parameters: ["tools"], architecture: { output_modalities: ["text"] } },
    { id: "acme/no-tools", name: "Acme: No Tools", supported_parameters: ["temperature"], architecture: { output_modalities: ["text"] } },
    { id: "acme/painter", name: "Acme: Painter", supported_parameters: ["tools"], architecture: { output_modalities: ["image"] } },
    { id: "anthropic/claude", name: "Anthropic: Claude", supported_parameters: ["tools"] },
    { id: "anthropic/claude:batch", name: "Anthropic: Claude (batch)", supported_parameters: ["tools"] },
    { name: "missing id" },
  ],
};

function openRouter(catalog: unknown = CATALOG, modelsStatus = 200) {
  const requests: { url: string; init: RequestInit }[] = [];
  const transport = keyTransport({
    key: async () => "sk-or-test",
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith("/models")) return new Response(JSON.stringify(catalog), { status: modelsStatus });
      if (url.endsWith("/key")) return new Response("{}", { status: 200 });
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
    },
  });
  return { transport, requests };
}

describe("own key model catalog", () => {
  it("keeps only live text models with tool calls", () => {
    expect(parseModels(CATALOG).map((m) => m.id)).toEqual(["z-ai/zeta", "google/gemini-3.8-flash", "anthropic/claude"]);
    expect(parseModels({ data: "nope" })).toEqual([]);
  });

  it("lists the recommended model first, then all others by name", async () => {
    const { transport, requests } = openRouter();
    const provider = new OpenRouterProvider("openrouter", transport, memoryThreads().store);
    await provider.check();
    const models = await provider.listModels();
    expect(models.map((m) => [m.id, m.isDefault])).toEqual([
      ["google/gemini-3.8-flash", true],
      ["anthropic/claude", false],
      ["z-ai/zeta", false],
    ]);
    expect(models.every((m) => m.efforts.includes("medium"))).toBe(true);
    const list = requests.find((r) => r.url.endsWith("/models"));
    expect((list?.init.headers as Obj).Authorization).toBe("Bearer sk-or-test");
  });

  it("falls back to the recommended model when the catalog does not load", async () => {
    const { transport } = openRouter({ error: "down" }, 500);
    const provider = new OpenRouterProvider("openrouter", transport, memoryThreads().store);
    const models = await provider.listModels();
    expect(models.map((m) => m.id)).toEqual(["google/gemini-3.8-flash"]);
  });

  it("sends the chosen model, else the recommended one", async () => {
    const { transport, requests } = openRouter();
    const signal = new AbortController().signal;
    await transport.complete({ model: "anthropic/claude", stream: true, messages: [] }, signal);
    await transport.complete({ model: "", stream: true, messages: [] }, signal);
    const sent = requests.filter((r) => r.url.endsWith("/chat/completions")).map((r) => (JSON.parse(r.init.body as string) as Obj).model);
    expect(sent).toEqual(["anthropic/claude", "google/gemini-3.8-flash"]);
  });

  it("offers no choice on the hosted agent", async () => {
    const transport = hostedTransport({
      signedIn: () => true,
      fetch: async () => new Response(JSON.stringify({ email: "a@b.de", model: { id: "m", label: "Modell" } }), { status: 200 }),
    });
    expect(transport.models).toBeUndefined();
    const provider = new OpenRouterProvider("agentz", transport, memoryThreads().store);
    await provider.check();
    expect((await provider.listModels()).map((m) => m.id)).toEqual(["m"]);
  });
});
