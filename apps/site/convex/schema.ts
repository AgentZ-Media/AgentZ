import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Account tables (user, session, ...) live in the Better Auth component.
// The app schema holds the cloud copy of the desktop apps and its
// bookkeeping.

/**
 * One record table per app keeps products apart: every app has its own
 * table, indexes and limits, and no query ever scans another app's data.
 * A record is the latest version of one local row: JSON, gzip-compressed
 * when that saves space (packages/kit/account/records.ts).
 */
const recordTable = () =>
  defineTable({
    userId: v.string(),
    /** `<entity>/<local ID>`. */
    recordId: v.string(),
    /** Per user and app, strictly increasing (see sync_heads). */
    rev: v.number(),
    deleted: v.boolean(),
    /** Record data up to INLINE_LIMIT; larger records live in file storage. */
    data: v.optional(v.bytes()),
    blob: v.optional(v.id("_storage")),
    size: v.number(),
    /**
     * Set only on end-to-end encrypted records of older app versions
     * (sync_keys). Devices skip them; `sync.dropEncrypted` deletes them.
     */
    keyId: v.optional(v.string()),
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
   * Wrapped data key of end-to-end encrypted sync in older app versions. The
   * first push of a current app deletes it with its records (sync.push).
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
