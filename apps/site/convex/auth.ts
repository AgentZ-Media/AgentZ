import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { requireRunMutationCtx } from "@convex-dev/better-auth/utils";
import { betterAuth } from "better-auth/minimal";
import { ConvexError } from "convex/values";
import { components, internal } from "./_generated/api";
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

/** WebView origins of the desktop apps (macOS/Linux, Windows) and of their
 * development servers (`pnpm dev:<app>`, ports 1420, 1430, ...). They use the
 * auth API with a bearer token from the app sign-in (appLink.ts), never cookies. */
export const APP_ORIGINS = [
  "tauri://localhost",
  "http://tauri.localhost",
  ...Array.from({ length: 8 }, (_, i) => `http://localhost:${1420 + i * 10}`),
];

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl, ...extraOrigins, ...APP_ORIGINS],
    // Desktop apps stay signed in while they are used at least every two
    // months; every use extends the session (at most once a day).
    session: { expiresIn: 60 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
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
    user: {
      deleteUser: {
        enabled: true,
        // The cloud copy of all apps goes with the account.
        afterDelete: async (user) => {
          await requireRunMutationCtx(ctx).runMutation(internal.sync.purge, { userId: user.id });
        },
      },
    },
    // Convex functions share no memory between requests, so limits live in the database.
    rateLimit: { enabled: true, storage: "database" },
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  });

/**
 * User ID behind a live session. A Convex JWT stays valid until it expires,
 * also after signing out or deleting the account; writes check the session
 * and the user themselves, so a deleted account never gets data back.
 */
export async function requireLiveUser(ctx: GenericCtx<DataModel>): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !(await authComponent.safeGetAuthUser(ctx))) {
    throw new ConvexError({ code: "UNAUTHENTICATED" });
  }
  return identity.subject;
}

/** The signed-in user, or null. Apps read their account through this query. */
export const currentUser = query({
  args: {},
  handler: async (ctx) => (await authComponent.safeGetAuthUser(ctx)) ?? null,
});
