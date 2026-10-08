// Problem reports from the apps (bugs.ts). Pure functions without Convex
// imports: bugs.ts applies them, tests/bugReports.test.mjs runs them without
// a deployment.
//
// Only signed-in users report; the account says who. A report is what the
// user wrote plus what the app collected about itself (app, version, system,
// window, recent errors). The app shows all of it before sending. Anything
// malformed in the collected part is cut or dropped, never a reason to lose
// the report; only the user's text is required.
//
// Every app of the suite may report without a backend change: the app ID is
// only checked for its form, not against a list.

/** The user's description. The app limits the field to the same length. */
export const MAX_MESSAGE_CHARS = 5000;
export const MAX_APP_NAME_CHARS = 60;
/** Collected key-value pairs (`details`) and recent error lines (`errors`). */
export const MAX_DETAILS = 60;
export const MAX_DETAIL_CHARS = 500;
export const MAX_ERRORS = 20;
export const MAX_ERROR_CHARS = 1000;
/** The whole request: the limits above fit with room to spare. */
export const MAX_BODY_CHARS = 64_000;

// Spam protection. Only signed-in accounts reach the limits at all (bugs.ts
// rejects everything else before reading the body); per account they stop
// loops and bursts, the global limit caps what a flood of accounts can store.
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** Reports per account within an hour and within a day. */
export const USER_HOUR_LIMIT = 10;
export const USER_DAY_LIMIT = 30;
/** Shortest gap between two reports of one account. */
export const MIN_GAP_MS = 15_000;
/** Reports of all accounts within an hour. */
export const GLOBAL_HOUR_LIMIT = 500;

const CHANNELS = new Set(["stable", "nightly", "dev"]);
const SYSTEMS = new Set(["macos", "windows", "linux"]);
const APP_ID = /^[a-z][a-z0-9-]{0,39}$/;
const INSTALL_ID = /^[A-Za-z0-9-]{8,64}$/;
const DETAIL_KEY = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

export interface BugReportInput {
  /** App ID, e.g. "scriptz". */
  app: string;
  /** Display name of the app, e.g. "ScriptZ". */
  appName?: string;
  /** Random ID of the app installation, kept by the app. */
  installId: string;
  message: string;
  version: string;
  /** "stable", "nightly", "dev" or "unknown". */
  channel: string;
  /** "macos", "windows", "linux" or "unknown". */
  os: string;
  details: Record<string, string>;
  errors: string[];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Text of a scalar detail value; null for anything else. */
function detailText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? cut(value.trim(), MAX_DETAIL_CHARS) : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return null;
}

/** The validated report, or null when the request is unusable. */
export function parseReport(raw: unknown): BugReportInput | null {
  if (!isObject(raw)) return null;
  const { app, appName, installId, message, version, channel, os, details, errors } = raw;
  if (typeof app !== "string" || !APP_ID.test(app)) return null;
  if (typeof installId !== "string" || !INSTALL_ID.test(installId)) return null;
  if (typeof message !== "string" || !message.trim()) return null;
  const report: BugReportInput = {
    app,
    installId,
    message: cut(message.trim(), MAX_MESSAGE_CHARS),
    version: typeof version === "string" && version.trim() ? cut(version.trim(), 64) : "unknown",
    channel: typeof channel === "string" && CHANNELS.has(channel) ? channel : "unknown",
    os: typeof os === "string" && SYSTEMS.has(os) ? os : "unknown",
    details: {},
    errors: [],
  };
  if (typeof appName === "string" && appName.trim()) report.appName = cut(appName.trim(), MAX_APP_NAME_CHARS);
  if (isObject(details)) {
    for (const [key, value] of Object.entries(details)) {
      if (Object.keys(report.details).length >= MAX_DETAILS) break;
      const text = DETAIL_KEY.test(key) ? detailText(value) : null;
      if (text !== null) report.details[key] = text;
    }
  }
  if (Array.isArray(errors)) {
    report.errors = errors
      .filter((line): line is string => typeof line === "string" && line.trim() !== "")
      .slice(-MAX_ERRORS)
      .map((line) => cut(line.trim(), MAX_ERROR_CHARS));
  }
  return report;
}

export type LimitResult =
  | { kind: "ok" }
  | { kind: "limited" }
  /** The same text again within an hour (double click, retry): answer with its number. */
  | { kind: "duplicate"; number: number };

/**
 * Whether one more report of an account may be stored. `own` are the
 * account's reports of the last day, newest first; `allLastHour` counts the
 * reports of all accounts within the last hour.
 */
export function checkLimits(input: {
  own: ReadonlyArray<{ number: number; message: string; createdAt: number }>;
  allLastHour: number;
  message: string;
  now: number;
}): LimitResult {
  const { own, allLastHour, message, now } = input;
  const lastHour = own.filter((report) => report.createdAt > now - HOUR_MS);
  const same = lastHour.find((report) => report.message === message);
  if (same) return { kind: "duplicate", number: same.number };
  if (own.length > 0 && now - own[0].createdAt < MIN_GAP_MS) return { kind: "limited" };
  if (lastHour.length >= USER_HOUR_LIMIT || own.length >= USER_DAY_LIMIT) return { kind: "limited" };
  if (allLastHour >= GLOBAL_HOUR_LIMIT) return { kind: "limited" };
  return { kind: "ok" };
}
