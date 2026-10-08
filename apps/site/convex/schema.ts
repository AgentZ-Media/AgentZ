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
    /**
     * Rank of a migration upload from end-to-end encrypted versions (twice the
     * old revision, plus one for a local change): a higher rank replaces this
     * record while the rank is even (no local change). Cleared by every
     * normal write.
     */
    legacyRank: v.optional(v.number()),
    /** Random ID of the writing device, lets a device skip its own echo. */
    deviceId: v.string(),
    updatedAt: v.number(),
  })
    .index("by_user_rev", ["userId", "rev"])
    .index("by_user_record", ["userId", "recordId"])
    .index("by_blob", ["blob"]);

export default defineSchema({
  scriptz_records: recordTable(),

  /**
   * Revision counter per user and app, and the highest sync format any device
   * wrote there (compat.ts). Devices that cannot read it pause their sync.
   * Missing on accounts from before format numbers: they hold format 1 data.
   */
  sync_heads: defineTable({
    userId: v.string(),
    app: v.string(),
    rev: v.number(),
    format: v.optional(v.number()),
    /** App version that raised the format, e.g. a nightly build. */
    formatBy: v.optional(v.string()),
  }).index("by_user_app", ["userId", "app"]),

  /**
   * Emergency switch per app, set by hand (syncPolicy.ts): versions below
   * `minVersion` and the listed versions may not sync. Absent means no limit.
   */
  sync_policy: defineTable({
    app: v.string(),
    minVersion: v.optional(v.string()),
    blockedVersions: v.optional(v.array(v.string())),
    updatedAt: v.number(),
  }).index("by_app", ["app"]),

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

  /** Newest published version per app and channel (releases.ts). */
  app_releases: defineTable({
    app: v.string(),
    channel: v.string(),
    version: v.string(),
    publishedAt: v.number(),
  }).index("by_app_channel", ["app", "channel"]),

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
   * Problem reports from the apps (bugs.ts), signed in or not. `number` counts
   * through all apps of the suite. `details` holds what the app collected
   * about itself (system, window, language, ...), `errors` its last error
   * messages; the app shows both before sending.
   */
  bug_reports: defineTable({
    number: v.number(),
    app: v.string(),
    message: v.string(),
    /** Contact address the user entered, if any. */
    email: v.optional(v.string()),
    /** Account of a signed-in reporter; removed with the account. */
    userId: v.optional(v.string()),
    /** Random ID of the app installation: limits and several reports of one device. */
    installId: v.string(),
    version: v.string(),
    channel: v.string(),
    os: v.string(),
    details: v.record(v.string(), v.string()),
    errors: v.array(v.string()),
    /** "new" when stored; for sorting them out later. */
    status: v.string(),
    createdAt: v.number(),
  })
    .index("by_number", ["number"])
    .index("by_app_number", ["app", "number"])
    .index("by_install", ["installId", "createdAt"])
    .index("by_created", ["createdAt"])
    .index("by_user", ["userId"]),

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
