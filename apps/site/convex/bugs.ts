import { v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { createAuth } from "./auth";
import { DAY_MS, HOUR_MS, MAX_BODY_CHARS, USER_DAY_LIMIT, checkLimits, parseReport } from "./bugReports";

// Problem reports from the apps of the suite ("Report a problem"), for
// signed-in users only. Every report gets the next number of the suite (#1,
// #2, ...), which the app shows as confirmation; `app` and `appName` say
// which program sent it. Reading them happens in the Convex dashboard (table
// bug_reports) or with `npx convex run bugs:recent` (docs/fehlermeldungen.md).

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Ctx = Parameters<Parameters<typeof httpAction>[0]>[0];

/** 401 only for a missing session (the app then signs out, like ai.ts); a
 *  failing check is 503, so a hiccup never ends the session. */
async function reporter(ctx: Ctx, request: Request): Promise<{ userId: string } | { response: Response }> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return { response: json({ error: "unauthorized" }, 401) };
  try {
    const session = await createAuth(ctx).api.getSession({ headers: new Headers({ authorization }) });
    return session?.user ? { userId: session.user.id } : { response: json({ error: "unauthorized" }, 401) };
  } catch (error) {
    console.warn("session check for a report failed", error instanceof Error ? error.message : String(error));
    return { response: json({ error: "unavailable" }, 503) };
  }
}

/** POST /bugs/report: stores one report and answers with its number. */
export const report = httpAction(async (ctx, request) => {
  const auth = await reporter(ctx, request);
  if ("response" in auth) return auth.response;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_CHARS * 4) return json({ error: "too_large" }, 413);
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return json({ error: "too_large" }, 413);
    raw = JSON.parse(text);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const parsed = parseReport(raw);
  if (!parsed) return json({ error: "invalid_request" }, 400);
  const number = await ctx.runMutation(internal.bugs.store, { ...parsed, userId: auth.userId });
  if (number === null) return json({ error: "rate_limited" }, 429);
  return json({ number });
});

/** Assigns the next number and stores the report; null above the limits
 *  (bugReports.checkLimits). The same text again answers with its number. */
export const store = internalMutation({
  args: {
    app: v.string(),
    appName: v.optional(v.string()),
    installId: v.string(),
    message: v.string(),
    userId: v.string(),
    version: v.string(),
    channel: v.string(),
    os: v.string(),
    details: v.record(v.string(), v.string()),
    errors: v.array(v.string()),
  },
  handler: async (ctx, report) => {
    const now = Date.now();
    const own = await ctx.db.query("bug_reports")
      .withIndex("by_user", (q) => q.eq("userId", report.userId).gt("createdAt", now - DAY_MS))
      .order("desc")
      .take(USER_DAY_LIMIT + 1);
    const allLastHour = await ctx.db.query("bug_reports")
      .withIndex("by_created", (q) => q.gt("createdAt", now - HOUR_MS))
      .take(1000);
    const limit = checkLimits({ own, allLastHour: allLastHour.length, message: report.message, now });
    if (limit.kind === "limited") return null;
    if (limit.kind === "duplicate") return limit.number;
    // Mutations are serializable: two reports at once never get the same number.
    const last = await ctx.db.query("bug_reports").withIndex("by_number").order("desc").first();
    const number = (last?.number ?? 0) + 1;
    await ctx.db.insert("bug_reports", { ...report, number, status: "new", createdAt: now });
    return number;
  },
});

/**
 * The newest reports, for reading them from the command line:
 * `npx convex run bugs:recent '{"limit": 20}'` (add `--prod` for production).
 */
export const recent = internalQuery({
  args: { app: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { app, limit }) => {
    const take = Math.min(Math.max(1, Math.floor(limit ?? 20)), 200);
    const rows = app
      ? await ctx.db.query("bug_reports").withIndex("by_app_number", (q) => q.eq("app", app)).order("desc").take(take)
      : await ctx.db.query("bug_reports").withIndex("by_number").order("desc").take(take);
    return rows.map(({ _id, _creationTime, ...row }) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }));
  },
});

const FORGET_BATCH = 200;

/** A deleted account's reports stay, but no longer point to it (sync.purge). */
export const forgetUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const batch = await ctx.db.query("bug_reports").withIndex("by_user", (q) => q.eq("userId", userId)).take(FORGET_BATCH);
    for (const row of batch) await ctx.db.patch(row._id, { userId: undefined });
    if (batch.length === FORGET_BATCH) await ctx.scheduler.runAfter(0, internal.bugs.forgetUser, { userId });
  },
});
