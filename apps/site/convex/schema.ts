import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Account tables (user, session, ...) live in the Better Auth component.
// The app schema holds only the end-to-end encrypted cloud copy of the
// desktop apps and its bookkeeping.

/**
 * One record table per app keeps products apart: every app has its own
 * table, indexes and limits, and no query ever scans another app's data.
 * A record is the latest encrypted version of one local row. The server
 * sees an opaque record ID, a revision, a size and ciphertext, never the
 * entity type, the local ID or any content.
 */
const recordTable = () =>
  defineTable({
    userId: v.string(),
    /** HMAC of entity and local ID, computed on the device. */
    recordId: v.string(),
    /** Per user and app, strictly increasing (see sync_heads). */
    rev: v.number(),
    deleted: v.boolean(),
    /** Ciphertext up to INLINE_LIMIT; larger records live in file storage. */
    data: v.optional(v.bytes()),
    blob: v.optional(v.id("_storage")),
    size: v.number(),
    /** Encryption key the ciphertext belongs to (sync_keys.keyId). */
    keyId: v.string(),
    /** Random ID of the writing device, lets a device skip its own echo. */
    deviceId: v.string(),
    updatedAt: v.number(),
  })
    .index("by_user_rev", ["userId", "rev"])
    .index("by_user_record", ["userId", "recordId"]);

export default defineSchema({
  scriptz_records: recordTable(),

  /** Revision counter per user and app. */
  sync_heads: defineTable({
    userId: v.string(),
    app: v.string(),
    rev: v.number(),
  }).index("by_user_app", ["userId", "app"]),

  /**
   * The account's data key, wrapped (encrypted) with a key derived from the
   * user's recovery key. Shared by all apps of the account. `resetting` is set
   * while old records are being removed after a key reset.
   */
  sync_keys: defineTable({
    userId: v.string(),
    keyId: v.string(),
    wrapped: v.bytes(),
    createdAt: v.number(),
    updatedAt: v.number(),
    resetting: v.optional(v.boolean()),
  }).index("by_user", ["userId"]),

  /**
   * Plain totals an account's devices report for the website's public
   * counters, such as the number of scripts. Never derived from content.
   */
  sync_stats: defineTable({
    userId: v.string(),
    app: v.string(),
    counts: v.record(v.string(), v.number()),
    updatedAt: v.number(),
  })
    .index("by_user_app", ["userId", "app"])
    .index("by_app", ["app"]),

  /** Sum of sync_stats per app, refreshed hourly; the website reads this. */
  site_stats: defineTable({
    app: v.string(),
    counts: v.record(v.string(), v.number()),
    updatedAt: v.number(),
  }).index("by_app", ["app"]),

  /**
   * Browser sign-in for desktop apps (PKCE): the website stores a short-lived
   * code for the app's challenge, only the app holding the verifier can
   * exchange it for a session.
   */
  app_links: defineTable({
    codeHash: v.string(),
    challenge: v.string(),
    userId: v.string(),
    app: v.string(),
    expiresAt: v.number(),
  })
    .index("by_code", ["codeHash"])
    .index("by_expiry", ["expiresAt"]),
});
