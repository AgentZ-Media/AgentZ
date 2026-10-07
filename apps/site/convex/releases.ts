import { v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalMutation, query } from "./_generated/server";
import { compareVersions, parseVersion } from "./compat";
import { appArg, isSyncApp } from "./syncApps";

// Newest published version per app and channel, announced by the release and
// nightly workflows right after the updater manifest is online. Signed-in
// apps subscribe to it and check for the update at once instead of waiting
// for their hourly check. Only a hint: the download, its signature and the
// decision what to install stay with the updater and GitHub.

const channelArg = v.union(v.literal("stable"), v.literal("nightly"));
type Channel = "stable" | "nightly";

/** Public: release versions are public on GitHub anyway. */
export const latest = query({
  args: { app: appArg },
  handler: async (ctx, { app }) => {
    const rows = await ctx.db.query("app_releases").withIndex("by_app_channel", (q) => q.eq("app", app)).collect();
    const pick = (channel: Channel) => rows.find((row) => row.channel === channel)?.version ?? null;
    return { stable: pick("stable"), nightly: pick("nightly") };
  },
});

/** Stores a newer version; an older or equal one changes nothing (reruns, races). */
export const record = internalMutation({
  args: { app: appArg, channel: channelArg, version: v.string() },
  handler: async (ctx, { app, channel, version }) => {
    const existing = await ctx.db.query("app_releases")
      .withIndex("by_app_channel", (q) => q.eq("app", app).eq("channel", channel))
      .unique();
    if (existing && (compareVersions(version, existing.version) ?? 0) <= 0) return false;
    const fields = { app, channel, version, publishedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, fields);
    else await ctx.db.insert("app_releases", fields);
    return true;
  },
});

const NIGHTLY = /-nightly\.\d+$/;

/** Byte-wise comparison in constant time for equal lengths. */
function sameSecret(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * POST /releases/announce with `Authorization: Bearer <RELEASE_ANNOUNCE_TOKEN>`
 * and `{ app, channel, version }`. Called by tooling/release/announce.mjs.
 */
export const announce = httpAction(async (ctx, request) => {
  const secret = process.env.RELEASE_ANNOUNCE_TOKEN;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || secret.length < 32 || !sameSecret(given, secret)) return json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const { app, channel, version } = body;
  const parsed = typeof version === "string" ? parseVersion(version) : null;
  const valid = isSyncApp(app) && (channel === "stable" || channel === "nightly")
    && typeof version === "string" && parsed !== null
    // Stable never carries a pre-release; nightly always is one.
    && (channel === "nightly" ? NIGHTLY.test(version) : parsed.pre.length === 0);
  if (!valid) return json({ error: "invalid_request" }, 400);
  const updated = await ctx.runMutation(internal.releases.record, { app, channel, version });
  return json({ updated });
});
