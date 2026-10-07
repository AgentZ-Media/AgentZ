import { v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalMutation } from "./_generated/server";
import { createAuth } from "./auth";
import { isSyncApp } from "./syncApps";

// Sign-in for desktop apps through the website, following OAuth for native
// apps (RFC 8252) with PKCE (RFC 7636):
//
// 1. The app keeps a random verifier and opens the website's app sign-in page
//    with challenge = base64url(SHA-256(verifier)).
// 2. After signing in there, "Open app" calls `approve`, which stores a
//    one-time code for that challenge, and hands the code to the app through
//    its URL scheme (agentz-<app>://auth?code=…).
// 3. The app calls `claim` with code and verifier and receives a session.
//
// A code alone is useless: only the app that created the challenge knows the
// verifier. Codes expire after five minutes and work exactly once.

const LINK_TTL_MS = 5 * 60 * 1000;
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const sha256 = async (text: string) => base64url(await crypto.subtle.digest("SHA-256", encoder.encode(text)));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Website, signed in: creates the one-time code for an app's challenge. */
export const approve = httpAction(async (ctx, request) => {
  const { app, challenge } = await readBody(request);
  if (!isSyncApp(app) || typeof challenge !== "string" || !BASE64URL_43.test(challenge)) {
    return json({ error: "invalid_request" }, 400);
  }
  // The website keeps its session in localStorage and sends it in this header
  // (cross-domain plugin); Better Auth reads it as a regular cookie.
  const headers = new Headers();
  const cookie = request.headers.get("better-auth-cookie");
  if (cookie) headers.set("cookie", cookie);
  const session = await createAuth(ctx).api.getSession({ headers });
  if (!session) return json({ error: "unauthorized" }, 401);
  const code = base64url(crypto.getRandomValues(new Uint8Array(32)));
  await ctx.runMutation(internal.appLink.store, {
    codeHash: await sha256(code), challenge, userId: session.user.id, app, expiresAt: Date.now() + LINK_TTL_MS,
  });
  return json({ code });
});

/** App: exchanges code and verifier for a session token. */
export const claim = httpAction(async (ctx, request) => {
  const { code, verifier } = await readBody(request);
  if (typeof code !== "string" || !BASE64URL_43.test(code) || typeof verifier !== "string" || !BASE64URL_43.test(verifier)) {
    return json({ error: "invalid_request" }, 400);
  }
  const link = await ctx.runMutation(internal.appLink.consume, { codeHash: await sha256(code) });
  if (!link || link.expiresAt < Date.now() || (await sha256(verifier)) !== link.challenge) {
    return json({ error: "invalid_grant" }, 400);
  }
  const auth = createAuth(ctx);
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(link.userId);
  if (!session) return json({ error: "server_error" }, 500);
  return json({ token: session.token, app: link.app });
});

export const store = internalMutation({
  args: { codeHash: v.string(), challenge: v.string(), userId: v.string(), app: v.string(), expiresAt: v.number() },
  handler: async (ctx, link) => {
    await ctx.db.insert("app_links", link);
  },
});

/** Returns the link and deletes it: a code works once, even if the check fails. */
export const consume = internalMutation({
  args: { codeHash: v.string() },
  handler: async (ctx, { codeHash }) => {
    const link = await ctx.db.query("app_links").withIndex("by_code", (q) => q.eq("codeHash", codeHash)).unique();
    if (!link) return null;
    await ctx.db.delete(link._id);
    return { userId: link.userId, app: link.app, challenge: link.challenge, expiresAt: link.expiresAt };
  },
});

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db.query("app_links")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now()))
      .take(500);
    for (const link of expired) await ctx.db.delete(link._id);
  },
});
