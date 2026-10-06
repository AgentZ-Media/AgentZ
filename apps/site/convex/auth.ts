import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { requireRunMutationCtx } from "@convex-dev/better-auth/utils";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { sendAccountEmail } from "./emails";

// SITE_URL is the canonical website origin. TRUSTED_ORIGINS (comma separated)
// adds further origins that may call the auth API, such as the apex domain.
const siteUrl = process.env.SITE_URL;
if (!siteUrl) throw new Error("SITE_URL is not set on this Convex deployment");
const extraOrigins = (process.env.TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl, ...extraOrigins],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      // Verification is offered, not required: unverified accounts can sign in.
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url, token }) =>
        sendAccountEmail(requireRunMutationCtx(ctx), "reset", { to: user.email, name: user.name, url, token }),
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: async ({ user, url, token }) =>
        sendAccountEmail(requireRunMutationCtx(ctx), "verify", { to: user.email, name: user.name, url, token }),
    },
    user: { deleteUser: { enabled: true } },
    // Convex functions share no memory between requests, so limits live in the database.
    rateLimit: { enabled: true, storage: "database" },
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  });

/** The signed-in user, or null. Apps read their account through this query. */
export const currentUser = query({
  args: {},
  handler: async (ctx) => (await authComponent.safeGetAuthUser(ctx)) ?? null,
});
