import type { CloudConfig } from "./types";

/** Production backend of the suite (Convex project agentz-suite, EU). These
 * are public addresses, the same for every build; no secrets live here. */
export const PRODUCTION_CLOUD: CloudConfig = {
  convexUrl: "https://proficient-cuttlefish-204.eu-west-1.convex.cloud",
  siteUrl: "https://proficient-cuttlefish-204.eu-west-1.convex.site",
  webUrl: "https://www.agentz-suite.com",
};

/** Build-time overrides (e.g. a development deployment); "off" disables accounts. */
export function readCloudConfig(env: Record<string, unknown>): CloudConfig | null {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().replace(/\/+$/, "") : undefined);
  if (text(env.VITE_AGENTZ_CLOUD) === "off") return null;
  return {
    convexUrl: text(env.VITE_AGENTZ_CONVEX_URL) ?? PRODUCTION_CLOUD.convexUrl,
    siteUrl: text(env.VITE_AGENTZ_CONVEX_SITE_URL) ?? PRODUCTION_CLOUD.siteUrl,
    webUrl: text(env.VITE_AGENTZ_WEB_URL) ?? PRODUCTION_CLOUD.webUrl,
  };
}
