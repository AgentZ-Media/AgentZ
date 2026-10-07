// The Better Auth client. Better Auth runs on the Convex deployment, a
// different origin than the website. The cross-domain plugin therefore keeps
// the session in localStorage and sends it as a header instead of a cookie.
// Pages load this module lazily through lazyAuth() (authForms.ts).
import { createAuthClient } from "better-auth/client";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";

export const createAuth = (baseURL: string) =>
  createAuthClient({ baseURL, plugins: [convexClient(), crossDomainClient()] });
export type Auth = ReturnType<typeof createAuth>;
