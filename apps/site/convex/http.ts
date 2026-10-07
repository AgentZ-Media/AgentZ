import { httpRouter } from "convex/server";
import { corsRouter } from "convex-helpers/server/cors";
import { approve, claim } from "./appLink";
import { APP_ORIGINS, authComponent, createAuth } from "./auth";
import { serve as serveStats } from "./stats";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: true });

// App sign-in through the website (appLink.ts): the website approves, the
// desktop app claims. Neither route uses cookies.
const siteOrigins = [process.env.SITE_URL, ...(process.env.TRUSTED_ORIGINS ?? "").split(",")]
  .map((origin) => origin?.trim())
  .filter((origin): origin is string => !!origin);
const appLinks = corsRouter(http, {
  allowedOrigins: [...siteOrigins, ...APP_ORIGINS],
  allowedHeaders: ["Content-Type", "Better-Auth-Cookie"],
  allowCredentials: false,
});
appLinks.route({ path: "/app-link/approve", method: "POST", handler: approve });
appLinks.route({ path: "/app-link/claim", method: "POST", handler: claim });

// Public counters for the website (stats.ts). No cookies, no user data.
http.route({ path: "/stats", method: "GET", handler: serveStats });

export default http;
