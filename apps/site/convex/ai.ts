import { httpAction } from "./_generated/server";
import { createAuth } from "./auth";

// Hosted agent of the apps: a thin, authenticated proxy in front of
// OpenRouter. Signed-in apps send OpenAI-style chat completion requests; the
// suite's OpenRouter key (OPENROUTER_API_KEY) never leaves this deployment
// and the server decides the model (OPENROUTER_MODEL), so the key cannot be
// used for anything else. The app runs the agent loop itself (tools execute
// locally), each request here is one model step.
//
// Open only to the accounts in AI_ACCESS for now (see hasAccess); the apps
// show "coming soon" to everyone else. Free and without limits for those
// accounts; usage limits belong here later.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** Fallback when OPENROUTER_MODEL is not set. Same id as
 *  `OPENROUTER_MODEL` in modules/scriptz/lib/agent/openrouter/config.ts. */
const DEFAULT_MODEL = "google/gemini-3.8-flash";
const MODEL_LABELS: Record<string, string> = { "google/gemini-3.8-flash": "Gemini 3.8 Flash" };

const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
const MAX_TOOLS = 64;
const MAX_MESSAGES = 2000;
const MAX_OUTPUT_TOKENS = 32_000;
/** Serialized messages per request; above the app's own context budget
 *  (about 1.2 million characters, lib/agent/openrouter/provider.ts). */
const MAX_REQUEST_CHARS = 2_000_000;
/** The whole request as it goes upstream (messages, tools and schemas). */
const MAX_BODY_CHARS = 2_500_000;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function model() {
  const id = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
  return { id, label: MODEL_LABELS[id] ?? id };
}

type AccountUser = { id: string; email: string; emailVerified: boolean };

/** Who may use the hosted agent: AI_ACCESS in the Convex environment,
 *  separated by commas. "*" opens it to every account, an entry with "@" is
 *  an e-mail address (verified accounts only, sign-up does not require a
 *  verification), any other entry an account ID. Unset or empty: nobody. */
export function hasAccess(user: AccountUser, list = process.env.AI_ACCESS ?? ""): boolean {
  const entries = list.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (entries.includes("*")) return true;
  if (entries.includes(user.id.toLowerCase())) return true;
  return user.emailVerified && entries.includes(user.email.trim().toLowerCase());
}

type Ctx = Parameters<Parameters<typeof httpAction>[0]>[0];

/** The user of the app's session (bearer token from the app sign-in), null
 *  without a valid session. Throws when the check itself fails. */
async function signedInUser(ctx: Ctx, request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const session = await createAuth(ctx).api.getSession({ headers: new Headers({ authorization }) });
  return session?.user ?? null;
}

/** 401 only for a missing session: the app signs out on 401, a failed check
 *  (auth or database hiccup) must not end the session of the whole suite.
 *  403 "not_enabled" for an account without access (the app shows "coming
 *  soon"). */
async function authorize(ctx: Ctx, request: Request) {
  try {
    const user = await signedInUser(ctx, request);
    if (!user) return { response: json({ error: "unauthorized" }, 401) };
    return hasAccess(user) ? { user } : { response: json({ error: "not_enabled" }, 403) };
  } catch (error) {
    console.warn("session check failed", error instanceof Error ? error.message : String(error));
    return { response: json({ error: "unavailable" }, 503) };
  }
}

/** Only what the agent needs passes through; everything else (other models,
 *  providers, presets, transforms) is dropped. */
export function upstreamBody(raw: Json, userId: string): Json | null {
  const messages = raw.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES || !messages.every(isObject)) return null;
  if (JSON.stringify(messages).length > MAX_REQUEST_CHARS) return null;
  const body: Json = { model: model().id, messages, stream: raw.stream === true, user: userId };
  if (raw.stream === true) body.usage = { include: true };
  if (Array.isArray(raw.tools)) {
    const tools = raw.tools.filter((tool) => isObject(tool) && tool.type === "function" && isObject(tool.function)).slice(0, MAX_TOOLS);
    if (tools.length) body.tools = tools;
  }
  if (raw.tool_choice === "auto" || raw.tool_choice === "none") body.tool_choice = raw.tool_choice;
  if (typeof raw.parallel_tool_calls === "boolean") body.parallel_tool_calls = raw.parallel_tool_calls;
  if (isObject(raw.reasoning) && EFFORTS.has(String(raw.reasoning.effort))) {
    body.reasoning = { effort: raw.reasoning.effort, ...(raw.reasoning.exclude === true ? { exclude: true } : {}) };
  }
  // Always capped, also when the client sends none.
  body.max_tokens = typeof raw.max_tokens === "number" && raw.max_tokens > 0 ? Math.min(raw.max_tokens, MAX_OUTPUT_TOKENS) : MAX_OUTPUT_TOKENS;
  // Web search for the agent's web_search tool: one engine, few results.
  if (Array.isArray(raw.plugins) && raw.plugins.some((plugin) => isObject(plugin) && plugin.id === "web")) {
    const web = raw.plugins.find((plugin) => isObject(plugin) && plugin.id === "web") as Json;
    const results = typeof web.max_results === "number" ? Math.min(Math.max(1, Math.round(web.max_results)), 8) : 5;
    body.plugins = [{ id: "web", engine: "exa", max_results: results }];
  }
  return body;
}

/** GET /ai/status: is the hosted agent available for this session, and with which model. */
export const status = httpAction(async (ctx, request) => {
  const auth = await authorize(ctx, request);
  if (!auth.user) return auth.response;
  const { user } = auth;
  if (!process.env.OPENROUTER_API_KEY) return json({ error: "unavailable" }, 503);
  const { id, label } = model();
  return json({ email: user.email, model: { id, label } });
});

/** POST /ai/chat: one chat completion step, streamed through unchanged. */
export const chat = httpAction(async (ctx, request) => {
  const auth = await authorize(ctx, request);
  if (!auth.user) return auth.response;
  const { user } = auth;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return json({ error: "unavailable" }, 503);
  // Size first, before the body is parsed: tools and schemas count as well.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_CHARS * 4) return json({ error: "too_large" }, 413);
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return json({ error: "too_large" }, 413);
    raw = JSON.parse(text);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const body = isObject(raw) ? upstreamBody(raw, user.id) : null;
  if (!body) return json({ error: "invalid_request" }, 400);
  const payload = JSON.stringify(body);
  if (payload.length > MAX_BODY_CHARS) return json({ error: "too_large" }, 413);
  const upstream = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.SITE_URL ?? "https://www.agentz-suite.com",
      "X-Title": "AgentZ Suite",
    },
    body: payload,
  });
  if (!upstream.ok || !upstream.body) {
    // Upstream details stay here; the app shows its own message.
    const detail = await upstream.text().catch(() => "");
    console.warn("openrouter request failed", upstream.status, detail.slice(0, 500));
    const status = upstream.status === 429 ? 429 : upstream.status === 400 ? 400 : 502;
    return json({ error: status === 429 ? "rate_limited" : status === 400 ? "invalid_request" : "upstream_error" }, status);
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? (body.stream ? "text/event-stream" : "application/json"),
      "Cache-Control": "no-cache",
    },
  });
});
