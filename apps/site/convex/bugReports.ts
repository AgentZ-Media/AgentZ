// Problem reports from the apps (bugs.ts). Pure functions without Convex
// imports: bugs.ts applies them, tests/bugReports.test.mjs runs them without
// a deployment.
//
// A report is what the user wrote plus what the app collected about itself
// (version, system, window, recent errors). The app shows all of it before
// sending. Anything malformed in the collected part is cut or dropped, never
// a reason to lose the report; only the user's text is required.

/** The user's description. The app limits the field to the same length. */
export const MAX_MESSAGE_CHARS = 5000;
export const MAX_EMAIL_CHARS = 200;
/** Collected key-value pairs (`details`) and recent error lines (`errors`). */
export const MAX_DETAILS = 60;
export const MAX_DETAIL_CHARS = 500;
export const MAX_ERRORS = 20;
export const MAX_ERROR_CHARS = 1000;
/** The whole request; generous for the limits above. */
export const MAX_BODY_CHARS = 200_000;
/** Reports per installation within WINDOW_MS: stops loops and spam of one device. */
export const INSTALL_LIMIT = 10;
/** Reports of all installations within WINDOW_MS: caps what a flood can store. */
export const GLOBAL_LIMIT = 500;
export const WINDOW_MS = 60 * 60 * 1000;

const CHANNELS = new Set(["stable", "nightly", "dev"]);
const SYSTEMS = new Set(["macos", "windows", "linux"]);
const APP_ID = /^[a-z][a-z0-9-]{0,39}$/;
const INSTALL_ID = /^[A-Za-z0-9-]{8,64}$/;
const DETAIL_KEY = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BugReportInput {
  app: string;
  /** Random ID of the app installation, kept by the app. */
  installId: string;
  message: string;
  /** Contact address the user entered, if any. */
  email?: string;
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
  const { app, installId, message, email, version, channel, os, details, errors } = raw;
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
  const contact = typeof email === "string" ? email.trim() : "";
  if (contact && contact.length <= MAX_EMAIL_CHARS && EMAIL.test(contact)) report.email = contact;
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

/** Whether another report fits into the limits, given the counts of the last WINDOW_MS. */
export function withinLimits(fromInstall: number, fromAll: number): boolean {
  return fromInstall < INSTALL_LIMIT && fromAll < GLOBAL_LIMIT;
}
