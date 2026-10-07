import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation, mutation, query, type MutationCtx, type QueryCtx,
} from "./_generated/server";
import {
  BATCH_LIMIT, INLINE_LIMIT, PULL_BYTES, RECORD_LIMIT, SYNC_APPS, appArg, type SyncApp,
} from "./syncApps";

// Record sync for the desktop apps. Devices push changed records with the
// revision they last saw (baseRev) and pull everything after their cursor.
// The server orders writes and detects when a device wrote on top of an
// outdated revision.

type Ctx = QueryCtx | MutationCtx;
type RecordDoc = Doc<"scriptz_records">;

async function requireUser(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

const legacyKeyOf = (ctx: Ctx, userId: string) =>
  ctx.db.query("sync_keys").withIndex("by_user", (q) => q.eq("userId", userId)).unique();

const headOf = (ctx: Ctx, userId: string, app: SyncApp) =>
  ctx.db.query("sync_heads").withIndex("by_user_app", (q) => q.eq("userId", userId).eq("app", app)).unique();

const recordsOf = (ctx: Ctx, app: SyncApp) => ctx.db.query(SYNC_APPS[app]);

async function blobUrl(ctx: Ctx, blob: Id<"_storage"> | undefined) {
  return blob ? (await ctx.storage.getUrl(blob)) ?? undefined : undefined;
}

function wire(record: RecordDoc, url?: string) {
  return {
    recordId: record.recordId,
    rev: record.rev,
    deleted: record.deleted,
    data: record.data,
    blobUrl: url,
    keyId: record.keyId,
    deviceId: record.deviceId,
  };
}

/** Current revision of the account; devices subscribe to this. */
export const head = query({
  args: { app: appArg },
  handler: async (ctx, { app }) => {
    const userId = await requireUser(ctx);
    const head = await headOf(ctx, userId, app);
    return { rev: head?.rev ?? 0 };
  },
});

/** Records after a revision, oldest first, bounded by count and bytes. */
export const pull = query({
  args: { app: appArg, afterRev: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { app, afterRev, limit }) => {
    const userId = await requireUser(ctx);
    const take = Math.max(1, Math.min(BATCH_LIMIT, Math.floor(limit ?? BATCH_LIMIT)));
    const page = await recordsOf(ctx, app)
      .withIndex("by_user_rev", (q) => q.eq("userId", userId).gt("rev", afterRev))
      .take(take + 1);
    const records = [];
    let bytes = 0;
    for (const record of page.slice(0, take)) {
      // Always return at least one record, so a cursor can never get stuck.
      if (records.length > 0 && bytes + record.size > PULL_BYTES) break;
      bytes += record.data ? record.size : 0;
      records.push(wire(record, await blobUrl(ctx, record.blob)));
    }
    const head = await headOf(ctx, userId, app);
    return { records, headRev: head?.rev ?? 0, more: records.length < page.length };
  },
});

/** Upload URL for a record too large to store inline. */
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

const change = v.object({
  recordId: v.string(),
  baseRev: v.number(),
  deleted: v.boolean(),
  data: v.optional(v.bytes()),
  blob: v.optional(v.id("_storage")),
  size: v.number(),
});

/**
 * Writes changes whose baseRev matches the stored revision. Any other change
 * comes back as a conflict carrying the current record, so the device can
 * apply the cloud version and keep its own as a copy. Deleting an already
 * deleted record is no conflict.
 */
export const push = mutation({
  args: { app: appArg, deviceId: v.string(), changes: v.array(change) },
  handler: async (ctx, { app, deviceId, changes }) => {
    const userId = await requireUser(ctx);
    if (changes.length > BATCH_LIMIT) throw new ConvexError({ code: "BATCH_TOO_LARGE" });
    // A current app took over: end-to-end encrypted data of older app
    // versions is unreadable for it and goes away.
    const legacyKey = await legacyKeyOf(ctx, userId);
    if (legacyKey) {
      await ctx.db.delete(legacyKey._id);
      for (const name of Object.keys(SYNC_APPS) as SyncApp[]) {
        await ctx.scheduler.runAfter(0, internal.sync.dropEncrypted, { userId, app: name, cursor: null });
      }
    }

    const head = await headOf(ctx, userId, app);
    let rev = head?.rev ?? 0;
    const now = Date.now();
    const results = [];
    for (const item of changes) {
      if (item.deleted ? item.data || item.blob : !item.data === !item.blob) {
        throw new ConvexError({ code: "INVALID_CHANGE", recordId: item.recordId });
      }
      if (item.data && (item.data.byteLength > INLINE_LIMIT || item.size !== item.data.byteLength)) {
        throw new ConvexError({ code: "INVALID_CHANGE", recordId: item.recordId });
      }
      if (item.size > RECORD_LIMIT) throw new ConvexError({ code: "RECORD_TOO_LARGE", recordId: item.recordId });
      const existing = await recordsOf(ctx, app)
        .withIndex("by_user_record", (q) => q.eq("userId", userId).eq("recordId", item.recordId))
        .unique();
      const current = existing?.rev ?? 0;
      if (item.baseRev !== current) {
        if (existing?.deleted && item.deleted) {
          results.push({ recordId: item.recordId, status: "ok" as const, rev: existing.rev });
        } else {
          // The uploaded file of a rejected change is not referenced anywhere.
          if (item.blob) await ctx.storage.delete(item.blob);
          results.push({
            recordId: item.recordId, status: "conflict" as const, rev: current,
            current: existing ? wire(existing, await blobUrl(ctx, existing.blob)) : null,
          });
        }
        continue;
      }
      rev += 1;
      const fields = {
        rev, deleted: item.deleted, data: item.data, blob: item.blob, size: item.deleted ? 0 : item.size,
        deviceId, updatedAt: now,
      };
      if (existing) {
        if (existing.blob && existing.blob !== item.blob) await ctx.storage.delete(existing.blob);
        await ctx.db.replace(existing._id, { userId, recordId: item.recordId, ...fields });
      } else {
        await ctx.db.insert(SYNC_APPS[app], { userId, recordId: item.recordId, ...fields });
      }
      results.push({ recordId: item.recordId, status: "ok" as const, rev });
    }
    if (head) {
      if (rev !== head.rev) await ctx.db.patch(head._id, { rev });
    } else if (rev > 0) {
      await ctx.db.insert("sync_heads", { userId, app, rev });
    }
    return { results, headRev: rev };
  },
});

const PURGE_BATCH = 200;

/** Deletes end-to-end encrypted records of older app versions, page by page. */
export const dropEncrypted = internalMutation({
  args: { userId: v.string(), app: appArg, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { userId, app, cursor }) => {
    const page = await recordsOf(ctx, app)
      .withIndex("by_user_rev", (q) => q.eq("userId", userId))
      .paginate({ numItems: PURGE_BATCH, cursor });
    for (const record of page.page) {
      if (record.keyId === undefined) continue;
      if (record.blob) await ctx.storage.delete(record.blob);
      await ctx.db.delete(record._id);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.sync.dropEncrypted, { userId, app, cursor: page.continueCursor });
    }
  },
});

/**
 * Removes a user's cloud data in batches when the account is deleted: every
 * app's records and files, the revision counters and the sign-in codes.
 */
export const purge = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    for (const app of Object.keys(SYNC_APPS) as SyncApp[]) {
      const batch = await recordsOf(ctx, app)
        .withIndex("by_user_rev", (q) => q.eq("userId", userId))
        .take(PURGE_BATCH);
      if (batch.length > 0) {
        for (const record of batch) {
          if (record.blob) await ctx.storage.delete(record.blob);
          await ctx.db.delete(record._id);
        }
        await ctx.scheduler.runAfter(0, internal.sync.purge, { userId });
        return;
      }
    }
    const heads = await ctx.db.query("sync_heads").withIndex("by_user_app", (q) => q.eq("userId", userId)).collect();
    for (const head of heads) await ctx.db.delete(head._id);
    const legacyKey = await legacyKeyOf(ctx, userId);
    if (legacyKey) await ctx.db.delete(legacyKey._id);
    const links = await ctx.db.query("app_links").filter((q) => q.eq(q.field("userId"), userId)).collect();
    for (const link of links) await ctx.db.delete(link._id);
  },
});
