import { createSignal } from "solid-js";
import { getCurrentLocale } from "../i18n";
import { getBuildInfo, getUpdatesStore, type KvStore, type PlatformAdapter, type SystemInfo } from "../platform";
import { baseSettingsStore } from "../stores/baseSettings";
import { shellUi } from "../stores/ui";
import { account } from "../account/account";
import { SessionExpiredError } from "../account/http";

// "Report a problem" for every app of the suite: a signed-in user describes
// what went wrong, the app adds what it knows about itself (which app,
// version, system, ...) and sends both to the suite backend
// (apps/site/convex/bugs.ts) with the account's session. Nothing from the
// user's content is collected; the dialog shows everything before sending.

/** Same limits as apps/site/convex/bugReports.ts. */
export const MAX_MESSAGE_CHARS = 5000;
const MAX_ERRORS = 20;
const MAX_ERROR_CHARS = 1000;
const INSTALL_STATE = "feedback.install";

export interface ReportContext {
  /** App ID and display name of the reporting app, e.g. "scriptz" / "ScriptZ". */
  app: string;
  appName: string;
  platform: PlatformAdapter;
  kv: KvStore;
  /** ID of the route on screen, e.g. "library". */
  route(): string | undefined;
}

/** What the app collected about itself, shown in the dialog and sent along. */
export interface CollectedInfo {
  app: string;
  appName: string;
  version: string;
  channel: string;
  os: string;
  details: Record<string, string>;
  errors: string[];
}

export type ReportErrorCode = "network" | "limit" | "expired" | "generic";

export class ReportError extends Error {
  constructor(readonly code: ReportErrorCode) { super(`report failed: ${code}`); this.name = "ReportError"; }
}

// ---- Recent errors ----

const errors: string[] = [];

function remember(kind: string, parts: unknown[]) {
  const text = parts.map(describe).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!text) return;
  const time = new Date().toISOString().slice(11, 19);
  errors.push(`${time} ${kind}: ${text}`.slice(0, MAX_ERROR_CHARS));
  if (errors.length > MAX_ERRORS) errors.splice(0, errors.length - MAX_ERRORS);
}

function describe(value: unknown): string {
  if (value instanceof Error) {
    // The first frames say where it happened; the rest is noise.
    const frames = value.stack?.split("\n").slice(1, 4).map((line) => line.trim()).join(" | ");
    return frames ? `${value.name}: ${value.message} (${frames})` : `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try { return JSON.stringify(value)?.slice(0, 300) ?? ""; } catch { return String(value); }
}

/**
 * Keeps the last errors and warnings of this window in memory for a report.
 * Nothing leaves the device unless the user sends a report. Returns the cleanup.
 */
export function startErrorLog(): () => void {
  if (typeof window === "undefined") return () => {};
  const onError = (event: ErrorEvent) => remember("error", [event.error ?? event.message]);
  const onRejection = (event: PromiseRejectionEvent) => remember("unhandled", [event.reason]);
  const original = { error: console.error, warn: console.warn };
  console.error = (...args: unknown[]) => { remember("error", args); original.error.apply(console, args); };
  console.warn = (...args: unknown[]) => { remember("warn", args); original.warn.apply(console, args); };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    console.error = original.error;
    console.warn = original.warn;
    errors.length = 0;
  };
}

// ---- Collecting ----

const size = (width: number, height: number) => `${Math.round(width)}x${Math.round(height)}`;

/** Everything the report carries besides the user's text. */
export async function collectInfo(context: ReportContext): Promise<CollectedInfo> {
  const { platform } = context;
  const build = platform.build ?? getBuildInfo();
  const [version, system] = await Promise.all([
    platform.getVersion().catch(() => "unknown"),
    platform.systemInfo?.().catch((): SystemInfo => ({})) ?? Promise.resolve<SystemInfo>({}),
  ]);
  const updates = getUpdatesStore();
  const block = account.syncBlock();
  const details: Record<string, string | number | boolean | undefined> = {
    commit: build.commit,
    builtAt: build.builtAt,
    osVersion: system.osVersion,
    arch: system.arch,
    systemLocale: system.locale ?? (typeof navigator !== "undefined" ? navigator.language : undefined),
    appLanguage: getCurrentLocale(),
    languageSetting: baseSettingsStore.language(),
    theme: baseSettingsStore.resolvedTheme(),
    themeSetting: baseSettingsStore.theme(),
    view: context.route(),
    sidebar: shellUi.sidebarOpen() ? "open" : "hidden",
    focusMode: shellUi.focused(),
    window: typeof window !== "undefined" ? size(window.innerWidth, window.innerHeight) : undefined,
    screen: typeof screen !== "undefined" ? size(screen.width, screen.height) : undefined,
    pixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : undefined,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    minutesOpen: typeof performance !== "undefined" ? Math.round(performance.now() / 60_000) : undefined,
    signedIn: account.signedIn(),
    sync: account.syncReady() ? account.syncPhase() : undefined,
    syncPaused: block ? block.reason : undefined,
    updateChannel: baseSettingsStore.updateChannel(),
    updateStatus: updates?.stage(),
    webView: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
  };
  return {
    app: context.app,
    appName: context.appName,
    version,
    channel: build.development ? "dev" : build.channel,
    os: platform.platform,
    details: Object.fromEntries(
      Object.entries(details)
        .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== "")
        .map(([key, value]) => [key, typeof value === "boolean" ? (value ? "yes" : "no") : String(value)]),
    ),
    errors: [...errors],
  };
}

/** Random ID of this installation: tells several devices of one account apart. */
async function installId(kv: KvStore): Promise<string> {
  const stored = await kv.getAppState(INSTALL_STATE).catch(() => null);
  if (stored && /^[A-Za-z0-9-]{8,64}$/.test(stored)) return stored;
  const id = crypto.randomUUID();
  await kv.setAppState(INSTALL_STATE, id).catch(() => {});
  return id;
}

// ---- Sending ----

/** Sends a report with the account's session; resolves with its number or throws ReportError. */
export async function sendReport(context: ReportContext, input: { message: string; info: CollectedInfo }): Promise<number> {
  const body = JSON.stringify({
    app: input.info.app,
    appName: input.info.appName,
    installId: await installId(context.kv),
    message: input.message.trim().slice(0, MAX_MESSAGE_CHARS),
    version: input.info.version,
    channel: input.info.channel,
    os: input.info.os,
    details: input.info.details,
    errors: input.info.errors,
  });
  let response: Response;
  try {
    response = await account.backendFetch("/bugs/report", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  } catch (caught) {
    throw new ReportError(caught instanceof SessionExpiredError ? "expired" : "network");
  }
  if (response.status === 429) throw new ReportError("limit");
  const result = await response.json().catch(() => null) as { number?: unknown } | null;
  if (!response.ok || typeof result?.number !== "number") throw new ReportError("generic");
  return result.number;
}

// ---- Draft ----

/** The text survives closing the dialog until it is sent. */
const [draft, setDraft] = createSignal("");
export const reportDraft = { message: draft, setMessage: setDraft, clear() { setDraft(""); } };
