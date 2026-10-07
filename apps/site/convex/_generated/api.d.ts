/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appLink from "../appLink.js";
import type * as auth from "../auth.js";
import type * as compat from "../compat.js";
import type * as crons from "../crons.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as keys from "../keys.js";
import type * as releases from "../releases.js";
import type * as stats from "../stats.js";
import type * as sync from "../sync.js";
import type * as syncApps from "../syncApps.js";
import type * as syncPolicy from "../syncPolicy.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appLink: typeof appLink;
  auth: typeof auth;
  compat: typeof compat;
  crons: typeof crons;
  emails: typeof emails;
  http: typeof http;
  keys: typeof keys;
  releases: typeof releases;
  stats: typeof stats;
  sync: typeof sync;
  syncApps: typeof syncApps;
  syncPolicy: typeof syncPolicy;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
