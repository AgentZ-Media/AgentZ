import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { clientArg, requireCompatible } from "./sync";
import { SYNC_APPS, STAT_KEYS, appArg, type SyncApp } from "./syncApps";

// Public counters for the website ("1,234 scripts written"). Records are end-to-end
// encrypted, so the server cannot count scripts itself: each signed-in device
// reports its account's plain totals (sync_stats), an hourly job sums them up
// (site_stats) and GET /stats serves that sum. The website reaches it through
// a Vercel rewrite whose CDN keeps the answer for an hour, so page views
// almost never reach Convex.

const MAX_COUNT = 1_000_000;
const PAGE = 1000;

/**
 * A device reports its account's totals; the latest report per account counts.
 * Like every sync call it carries the device's version and format: a device
 * that may not sync (CLIENT_OUTDATED) does not report either.
 */
export const report = mutation({
  args: { app: appArg, client: clientArg, counts: v.record(v.string(), v.number()) },
  handler: async (ctx, { app, client, counts }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    await requireCompatible(ctx, identity.subject, app, client);
    const allowed = STAT_KEYS[app];
    for (const [key, value] of Object.entries(counts)) {
      if (!allowed.includes(key) || !Number.isInteger(value) || value < 0 || value > MAX_COUNT) {
        throw new ConvexError({ code: "INVALID_STATS" });
      }
    }
    const userId = identity.subject;
    const existing = await ctx.db.query("sync_stats")
      .withIndex("by_user_app", (q) => q.eq("userId", userId).eq("app", app))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { counts, updatedAt: Date.now() });
    else await ctx.db.insert("sync_stats", { userId, app, counts, updatedAt: Date.now() });
  },
});

export const page = internalQuery({
  args: { app: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { app, cursor }) => {
    const result = await ctx.db.query("sync_stats")
      .withIndex("by_app", (q) => q.eq("app", app))
      .paginate({ cursor, numItems: PAGE });
    const sums: Record<string, number> = {};
    for (const row of result.page) {
      for (const [key, value] of Object.entries(row.counts)) sums[key] = (sums[key] ?? 0) + value;
    }
    return { sums, cursor: result.continueCursor, done: result.isDone };
  },
});

export const store = internalMutation({
  args: { app: v.string(), counts: v.record(v.string(), v.number()) },
  handler: async (ctx, { app, counts }) => {
    const existing = await ctx.db.query("site_stats").withIndex("by_app", (q) => q.eq("app", app)).unique();
    if (existing) await ctx.db.patch(existing._id, { counts, updatedAt: Date.now() });
    else await ctx.db.insert("site_stats", { app, counts, updatedAt: Date.now() });
  },
});

/** Hourly (crons.ts): sums every account's report per app, page by page. */
export const refresh = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const app of Object.keys(SYNC_APPS) as SyncApp[]) {
      const counts: Record<string, number> = Object.fromEntries(STAT_KEYS[app].map((key) => [key, 0]));
      let cursor: string | null = null;
      for (;;) {
        const result: { sums: Record<string, number>; cursor: string; done: boolean } =
          await ctx.runQuery(internal.stats.page, { app, cursor });
        for (const [key, value] of Object.entries(result.sums)) {
          if (key in counts) counts[key] += value;
        }
        if (result.done) break;
        cursor = result.cursor;
      }
      await ctx.runMutation(internal.stats.store, { app, counts });
    }
  },
});

export const current = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("site_stats").collect();
    const apps: Record<string, Record<string, number>> = {};
    let updatedAt = 0;
    for (const row of rows) {
      apps[row.app] = row.counts;
      updatedAt = Math.max(updatedAt, row.updatedAt);
    }
    return { apps, updatedAt: updatedAt || null };
  },
});

/** GET /stats: the latest sums. Browsers keep them five minutes, Vercel's CDN an hour. */
export const serve = httpAction(async (ctx) => {
  const body = await ctx.runQuery(internal.stats.current, {});
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      "CDN-Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
