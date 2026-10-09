import { httpRouter } from "convex/server";
import { corsRouter } from "convex-helpers/server/cors";
import { chat, decide, status } from "./ai";
import { approve, claim } from "./appLink";
import { APP_ORIGINS, authComponent, createAuth } from "./auth";
import { report } from "./bugs";
import { announce } from "./releases";
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

// Hosted agent of the apps (ai.ts): bearer session from the app sign-in.
const ai = corsRouter(http, {
  allowedOrigins: APP_ORIGINS,
  allowedHeaders: ["Content-Type", "Authorization"],
  allowCredentials: false,
});
ai.route({ path: "/ai/status", method: "GET", handler: status });
ai.route({ path: "/ai/chat", method: "POST", handler: chat });
ai.route({ path: "/ai/decide", method: "POST", handler: decide });

// Problem reports of the apps (bugs.ts): bearer session from the app sign-in.
const bugs = corsRouter(http, {
  allowedOrigins: APP_ORIGINS,
  allowedHeaders: ["Content-Type", "Authorization"],
  allowCredentials: false,
});
bugs.route({ path: "/bugs/report", method: "POST", handler: report });

// Release and nightly workflows announce new versions (releases.ts). No CORS:
// only the workflows call it, with a bearer secret.
http.route({ path: "/releases/announce", method: "POST", handler: announce });

// Public counters for the website (stats.ts). No cookies, no user data.
http.route({ path: "/stats", method: "GET", handler: serveStats });

export default http;
