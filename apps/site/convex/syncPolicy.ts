import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { policyError } from "./compat";
import { appArg } from "./syncApps";

// Emergency switch for the sync of one app: a minimum version and single
// blocked versions (compat.ts). Internal only, set from a terminal with the
// deployment's key, e.g. for a version that writes broken data:
//
//   npx convex run --prod syncPolicy:set '{"app":"scriptz","blockedVersions":["0.10.2"]}'
//   npx convex run --prod syncPolicy:set '{"app":"scriptz"}'        # lift all limits
//
// Devices notice a change live through their head subscription. Never set a
// minimum above the newest published release: those devices could not update.

export const get = internalQuery({
  args: { app: appArg },
  handler: async (ctx, { app }) => ctx.db.query("sync_policy").withIndex("by_app", (q) => q.eq("app", app)).unique(),
});

/** Replaces the policy of an app; omitted fields mean no limit. */
export const set = internalMutation({
  args: { app: appArg, minVersion: v.optional(v.string()), blockedVersions: v.optional(v.array(v.string())) },
  handler: async (ctx, { app, minVersion, blockedVersions }) => {
    const error = policyError({ minVersion, blockedVersions });
    if (error) throw new ConvexError({ code: "INVALID_POLICY", message: error });
    const existing = await ctx.db.query("sync_policy").withIndex("by_app", (q) => q.eq("app", app)).unique();
    const fields = { app, minVersion, blockedVersions, updatedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, fields);
    else await ctx.db.insert("sync_policy", fields);
  },
});
