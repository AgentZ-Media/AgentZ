import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

// The account's data key exists only on the user's devices. The server keeps
// a copy wrapped with a key derived from the recovery key, so a new device
// can unlock it with that recovery key. Without it nobody can read the data.

const WRAPPED_MAX = 1024;

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

const keyOf = (ctx: QueryCtx | MutationCtx, userId: string) =>
  ctx.db.query("sync_keys").withIndex("by_user", (q) => q.eq("userId", userId)).unique();

function checkWrapped(wrapped: ArrayBuffer, keyId: string) {
  if (wrapped.byteLength === 0 || wrapped.byteLength > WRAPPED_MAX || !/^[A-Za-z0-9_-]{16,64}$/.test(keyId)) {
    throw new ConvexError({ code: "INVALID_KEY" });
  }
}

/** The wrapped key, or null before the first device turned sync on. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const key = await keyOf(ctx, userId);
    return key ? { keyId: key.keyId, wrapped: key.wrapped, resetting: key.resetting ?? false } : null;
  },
});

/** First device: stores the new key. Fails if another device was faster. */
export const create = mutation({
  args: { keyId: v.string(), wrapped: v.bytes() },
  handler: async (ctx, { keyId, wrapped }) => {
    const userId = await requireUser(ctx);
    checkWrapped(wrapped, keyId);
    if (await keyOf(ctx, userId)) throw new ConvexError({ code: "KEY_EXISTS" });
    const now = Date.now();
    await ctx.db.insert("sync_keys", { userId, keyId, wrapped, createdAt: now, updatedAt: now });
  },
});

/** New recovery key for the same data key; the old recovery key stops working. */
export const rewrap = mutation({
  args: { keyId: v.string(), wrapped: v.bytes() },
  handler: async (ctx, { keyId, wrapped }) => {
    const userId = await requireUser(ctx);
    checkWrapped(wrapped, keyId);
    const key = await keyOf(ctx, userId);
    if (!key || key.keyId !== keyId) throw new ConvexError({ code: "KEY_CHANGED" });
    await ctx.db.patch(key._id, { wrapped, updatedAt: Date.now() });
  },
});

/**
 * Lost recovery key: replaces the key and deletes all cloud data encrypted
 * with the old one. Devices then upload their local data again. Local data
 * on the devices is never touched by this.
 */
export const reset = mutation({
  args: { keyId: v.string(), wrapped: v.bytes() },
  handler: async (ctx, { keyId, wrapped }) => {
    const userId = await requireUser(ctx);
    checkWrapped(wrapped, keyId);
    const key = await keyOf(ctx, userId);
    const now = Date.now();
    if (key) await ctx.db.patch(key._id, { keyId, wrapped, updatedAt: now, resetting: true });
    else await ctx.db.insert("sync_keys", { userId, keyId, wrapped, createdAt: now, updatedAt: now, resetting: true });
    await ctx.scheduler.runAfter(0, internal.sync.purge, { userId, keepKey: true });
  },
});
