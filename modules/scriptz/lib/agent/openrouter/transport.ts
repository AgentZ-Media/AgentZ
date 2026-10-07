// Where the harness' requests go. Both transports speak the same
// OpenAI-style chat completion protocol, so the harness (provider.ts) is the
// same for both:
// - hosted: the suite backend (apps/site/convex/ai.ts) with the AgentZ
//   session; the suite's OpenRouter key stays on the server.
// - key: OpenRouter directly with the user's own key (from the keychain).

import { AGENT_KEY_INVALID, AGENT_NETWORK, AGENT_NO_CREDITS, AGENT_NOT_ENABLED, AGENT_RATE_LIMITED, AGENT_SIGNED_OUT, type ProviderState } from "../types";
import { obj } from "../toolArgs";
import { OPENROUTER_API, OPENROUTER_MODEL, OPENROUTER_MODEL_LABEL } from "./config";

export interface TransportModel {
  id: string;
  label: string;
}

export interface TransportCheck {
  state: ProviderState;
  model: TransportModel | null;
}

export interface OpenRouterTransport {
  check(): Promise<TransportCheck>;
  /** One chat completion request. Resolves with the response body (SSE when
   *  `body.stream`); throws `TransportError` for a non-2xx answer. */
  complete(body: Record<string, unknown>, signal: AbortSignal): Promise<Response>;
}

/** A failed request, with one of the `AGENT_*` codes as message where the
 *  UI has its own text. */
export class TransportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const DEFAULT_MODEL: TransportModel = { id: OPENROUTER_MODEL, label: OPENROUTER_MODEL_LABEL };

function errorFor(status: number, detail: string): TransportError {
  if (status === 401) return new TransportError(AGENT_SIGNED_OUT, status);
  if (status === 402) return new TransportError(AGENT_NO_CREDITS, status);
  // The suite backend opens the hosted agent account by account.
  if (status === 403 && detail === "not_enabled") return new TransportError(AGENT_NOT_ENABLED, status);
  if (status === 429) return new TransportError(AGENT_RATE_LIMITED, status);
  return new TransportError(detail || `request failed (${status})`, status);
}

async function detailOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = obj(JSON.parse(text));
    const error = body.error;
    if (typeof error === "string") return error;
    const message = obj(error).message;
    if (typeof message === "string") return message;
  } catch {
    // Not JSON: the text itself.
  }
  return text.slice(0, 300);
}

/** fetch that reports a missing network as AGENT_NETWORK (aborts stay aborts). */
async function send(input: string, init: RequestInit, fetcher: (input: string, init: RequestInit) => Promise<Response>): Promise<Response> {
  try {
    return await fetcher(input, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if (error instanceof TransportError) throw error;
    console.warn("[agent] request failed", error);
    throw new TransportError(AGENT_NETWORK, 0);
  }
}

export interface HostedDeps {
  signedIn(): boolean;
  /** Authorized request to the suite backend (`path` below its site URL). */
  fetch(path: string, init: RequestInit): Promise<Response>;
}

export function hostedTransport(deps: HostedDeps): OpenRouterTransport {
  const call = (path: string, init: RequestInit) => send(path, init, (p, i) => deps.fetch(p, i));
  return {
    async check() {
      if (!deps.signedIn()) return { state: { state: "logged-out" }, model: null };
      try {
        const response = await call("/ai/status", { method: "GET" });
        if (response.status === 401) return { state: { state: "logged-out" }, model: null };
        if (!response.ok) return { state: { state: "error", message: errorFor(response.status, await detailOf(response)).message }, model: null };
        const body = obj(await response.json());
        const model = obj(body.model);
        return {
          state: { state: "ready", account: typeof body.email === "string" ? body.email : null },
          model: typeof model.id === "string" ? { id: model.id, label: typeof model.label === "string" ? model.label : model.id } : DEFAULT_MODEL,
        };
      } catch (error) {
        // Signed out meanwhile (the account turns a 401 into an error too).
        if (!deps.signedIn()) return { state: { state: "logged-out" }, model: null };
        return { state: { state: "error", message: error instanceof Error ? error.message : String(error) }, model: null };
      }
    },
    async complete(body, signal) {
      if (!deps.signedIn()) throw new TransportError(AGENT_SIGNED_OUT, 401);
      const response = await call("/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok || !response.body) throw errorFor(response.status, await detailOf(response));
      return response;
    },
  };
}

export interface KeyDeps {
  key(): Promise<string | null>;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

/** Last characters of a key, enough to recognize it. */
export function keyHint(key: string): string {
  return `…${key.trim().slice(-4)}`;
}

export function keyTransport(deps: KeyDeps): OpenRouterTransport {
  const fetcher = deps.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const headers = (key: string) => ({
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://www.agentz-suite.com",
    "X-Title": "AgentZ Suite",
  });
  return {
    async check() {
      const key = (await deps.key())?.trim();
      if (!key) return { state: { state: "logged-out" }, model: null };
      try {
        const response = await send(`${OPENROUTER_API}/key`, { headers: headers(key) }, fetcher);
        if (response.status === 401) return { state: { state: "error", message: AGENT_KEY_INVALID }, model: null };
        if (!response.ok) return { state: { state: "error", message: await detailOf(response) }, model: null };
        return { state: { state: "ready", account: `OpenRouter ${keyHint(key)}` }, model: DEFAULT_MODEL };
      } catch (error) {
        return { state: { state: "error", message: error instanceof Error ? error.message : String(error) }, model: null };
      }
    },
    async complete(body, signal) {
      const key = (await deps.key())?.trim();
      if (!key) throw new TransportError(AGENT_KEY_INVALID, 401);
      const response = await send(`${OPENROUTER_API}/chat/completions`, {
        method: "POST",
        headers: headers(key),
        body: JSON.stringify({ ...body, model: OPENROUTER_MODEL, ...(body.stream ? { usage: { include: true } } : {}) }),
        signal,
      }, fetcher);
      if (response.status === 401) throw new TransportError(AGENT_KEY_INVALID, 401);
      if (!response.ok || !response.body) throw errorFor(response.status, await detailOf(response));
      return response;
    },
  };
}
