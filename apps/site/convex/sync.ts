import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation, mutation, query, type MutationCtx, type QueryCtx,
} from "./_generated/server";
import { blockFor, devRaiseDenied, markOf, raisedMark, type ClientInfo, type SyncBlock } from "./compat";
import {
  BATCH_LIMIT, INLINE_LIMIT, PULL_BYTES, RECORD_LIMIT, SYNC_APPS, appArg, type SyncApp,
} from "./syncApps";

// Encrypted record sync for the desktop apps. Devices push changed records
// with the revision they last saw (baseRev) and pull everything after their
// cursor. The server never decrypts anything; it only orders writes and
// detects when a device wrote on top of an outdated revision.
//
// Every call carries the device's version and sync format (`client`). A
// device that cannot read the account's data or that the policy excludes
// gets CLIENT_OUTDATED and pauses until it is updated (compat.ts).

type Ctx = QueryCtx | MutationCtx;
type RecordDoc = Doc<"scriptz_records">;

async function requireUser(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

const keyOf = (ctx: Ctx, userId: string) =>
  ctx.db.query("sync_keys").withIndex("by_user", (q) => q.eq("userId", userId)).unique();

const headOf = (ctx: Ctx, userId: string, app: SyncApp) =>
  ctx.db.query("sync_heads").withIndex("by_user_app", (q) => q.eq("userId", userId).eq("app", app)).unique();

const recordsOf = (ctx: Ctx, app: SyncApp) => ctx.db.query(SYNC_APPS[app]);

const policyOf = (ctx: Ctx, app: SyncApp) =>
  ctx.db.query("sync_policy").withIndex("by_app", (q) => q.eq("app", app)).unique();

/** Version and sync format of the calling device. Optional only so that
 * versions from before the check get CLIENT_OUTDATED instead of a validation error. */
const clientArg = v.optional(v.object({
  version: v.string(),
  reads: v.number(),
  writes: v.number(),
  channel: v.optional(v.string()),
}));

async function blockOf(ctx: Ctx, userId: string, app: SyncApp, client: ClientInfo | undefined): Promise<SyncBlock | null> {
  const [head, policy] = await Promise.all([headOf(ctx, userId, app), policyOf(ctx, app)]);
  return blockFor(client, markOf(head), policy);
}

/** Throws CLIENT_OUTDATED (with the reason) unless this device may sync. */
async function requireCompatible(ctx: Ctx, userId: string, app: SyncApp, client: ClientInfo | undefined): Promise<ClientInfo> {
  const block = await blockOf(ctx, userId, app, client);
  if (block || !client) throw new ConvexError({ code: "CLIENT_OUTDATED", block: block ?? { reason: "version", minVersion: null } });
  return client;
}

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

/**
 * Current revision and key of the account, and whether this device may sync;
 * devices subscribe to this. Never throws for an outdated device, so the
 * subscription keeps running and lifts the pause when the policy changes.
 */
export const head = query({
  args: { app: appArg, client: clientArg },
  handler: async (ctx, { app, client }) => {
    const userId = await requireUser(ctx);
    const [head, key, block] = await Promise.all([headOf(ctx, userId, app), keyOf(ctx, userId), blockOf(ctx, userId, app, client)]);
    return { rev: head?.rev ?? 0, keyId: key?.keyId ?? null, resetting: key?.resetting ?? false, block };
  },
});

/** Records after a revision, oldest first, bounded by count and bytes. */
export const pull = query({
  args: { app: appArg, client: clientArg, afterRev: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { app, client, afterRev, limit }) => {
    const userId = await requireUser(ctx);
    await requireCompatible(ctx, userId, app, client);
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
  args: { app: v.optional(appArg), client: clientArg },
  handler: async (ctx, { app, client }) => {
    const userId = await requireUser(ctx);
    if (!app) throw new ConvexError({ code: "CLIENT_OUTDATED", block: { reason: "version", minVersion: null } });
    await requireCompatible(ctx, userId, app, client);
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
  args: { app: appArg, client: clientArg, keyId: v.string(), deviceId: v.string(), changes: v.array(change) },
  handler: async (ctx, { app, client: reported, keyId, deviceId, changes }) => {
    const userId = await requireUser(ctx);
    if (changes.length > BATCH_LIMIT) throw new ConvexError({ code: "BATCH_TOO_LARGE" });
    const client = await requireCompatible(ctx, userId, app, reported);
    const key = await keyOf(ctx, userId);
    if (!key || key.resetting) throw new ConvexError({ code: "NO_KEY" });
    if (key.keyId !== keyId) throw new ConvexError({ code: "KEY_CHANGED" });

    const head = await headOf(ctx, userId, app);
    const mark = markOf(head);
    if (devRaiseDenied(client, mark, process.env.ALLOW_DEV_FORMAT_RAISE === "1")) {
      throw new ConvexError({ code: "DEV_FORMAT_RAISE", format: mark.format, writes: client.writes });
    }
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
        keyId, deviceId, updatedAt: now,
      };
      if (existing) {
        if (existing.blob && existing.blob !== item.blob) await ctx.storage.delete(existing.blob);
        await ctx.db.replace(existing._id, { userId, recordId: item.recordId, ...fields });
      } else {
        await ctx.db.insert(SYNC_APPS[app], { userId, recordId: item.recordId, ...fields });
      }
      results.push({ recordId: item.recordId, status: "ok" as const, rev });
    }
    // Records in this client's format exist from now on: devices that cannot
    // read it pause (compat.ts). Only written records raise the mark.
    const raised = rev !== (head?.rev ?? 0) ? raisedMark(client, mark) : null;
    const format = raised ? { format: raised.format, formatBy: client.version } : {};
    if (head) {
      if (rev !== head.rev) await ctx.db.patch(head._id, { rev, ...format });
    } else if (rev > 0) {
      await ctx.db.insert("sync_heads", { userId, app, rev, ...format });
    }
    return { results, headRev: rev };
  },
});

const PURGE_BATCH = 200;

/**
 * Removes a user's cloud data in batches: every app's records and files, the
 * revision counters and, unless `keepKey`, the key itself. Used for a key
 * reset (keepKey: the new key stays, `resetting` is cleared at the end) and
 * when the account is deleted.
 */
export const purge = internalMutation({
  args: { userId: v.string(), keepKey: v.boolean() },
  handler: async (ctx, { userId, keepKey }) => {
    for (const app of Object.keys(SYNC_APPS) as SyncApp[]) {
      const batch = await recordsOf(ctx, app)
        .withIndex("by_user_rev", (q) => q.eq("userId", userId))
        .take(PURGE_BATCH);
      if (batch.length > 0) {
        for (const record of batch) {
          if (record.blob) await ctx.storage.delete(record.blob);
          await ctx.db.delete(record._id);
        }
        await ctx.scheduler.runAfter(0, internal.sync.purge, { userId, keepKey });
        return;
      }
    }
    const heads = await ctx.db.query("sync_heads").withIndex("by_user_app", (q) => q.eq("userId", userId)).collect();
    for (const head of heads) await ctx.db.delete(head._id);
    const key = await keyOf(ctx, userId);
    if (key && keepKey) await ctx.db.patch(key._id, { resetting: false, updatedAt: Date.now() });
    else if (key) await ctx.db.delete(key._id);
    if (!keepKey) {
      const links = await ctx.db.query("app_links").filter((q) => q.eq(q.field("userId"), userId)).collect();
      for (const link of links) await ctx.db.delete(link._id);
    }
  },
});
