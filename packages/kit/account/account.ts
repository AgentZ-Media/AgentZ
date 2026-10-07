import { createSignal } from "solid-js";
import { language } from "../i18n";
import { registerFlusher } from "../lib";
import type { KvStore, PlatformAdapter } from "../platform";
import { CLOUD_FORMAT, createSqlSyncBook, readSyncState, writeSyncState, type SyncBook, type SyncState } from "./book";
import { createSyncEngine, type SyncEngine } from "./engine";
import { claimSession, fetchUser, revokeSession, SessionExpiredError } from "./http";
import { randomBytes, sha256Base64Url, toBase64Url } from "./records";
import type { CloudTransport } from "./transport";
import type { AccountUser, CloudConfig, SecretStore, SyncAdapter } from "./types";

// Account runtime of one app window: browser sign-in, session and the sync
// engine. All state is exposed as signals on `account`; the
// runtime starts in SuiteShell when the host passes a CloudConfig.

export type AccountPhase = "off" | "signedOut" | "waiting" | "connecting" | "signedIn";
export type SyncPhase = "idle" | "syncing" | "offline" | "error";
export type AccountDialogKind = "signIn" | "merge";

const SESSION_SECRET = "account.session";
/** Data key of end-to-end encrypted sync in older app versions; removed when found. */
const LEGACY_KEY_SECRET = "sync.key";
const PROFILE_STATE = "account.profile";
const POLL_MS = 3000;
const SETTINGS_POLL_MS = 30_000;
const QUIET_PUSH_MS = 15_000;

const [phase, setPhase] = createSignal<AccountPhase>("off");
const [user, setUser] = createSignal<AccountUser | null>(null);
/** The sync engine runs for the signed-in account. */
const [syncReady, setSyncReady] = createSignal(false);
const [syncPhase, setSyncPhase] = createSignal<SyncPhase>("idle");
const [lastSyncedAt, setLastSyncedAt] = createSignal<number | null>(null);
const [dialog, setDialog] = createSignal<AccountDialogKind | null>(null);
const [error, setError] = createSignal<string | null>(null);
const [notice, setNotice] = createSignal<"expired" | null>(null);
const [mergeFrom, setMergeFrom] = createSignal<string | null>(null);
const [conflictCopies, setConflictCopies] = createSignal(0);
const [syncAvailable, setSyncAvailable] = createSignal(false);

/** Error codes shown by the dialogs (texts in the Kit catalog, account.error.*). */
export type AccountError = "network" | "claim" | "generic";

interface Runtime {
  cloud: CloudConfig;
  app: string;
  platform: PlatformAdapter;
  kv: KvStore;
  secrets: SecretStore;
  adapter?: SyncAdapter;
  book: SyncBook;
  signal: AbortSignal;
  token: string | null;
  transport: CloudTransport | null;
  engine: SyncEngine | null;
  pendingVerifier: string | null;
  stopEngine: (() => void) | null;
}
let rt: Runtime | null = null;

function memorySecrets(): SecretStore {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
  };
}

const fail = (code: AccountError) => setError(code);

// ---- Sign-in ----

/** One way in for both: the website page offers signing in and signing up. */
async function signIn() {
  const r = rt;
  if (!r) return;
  const verifier = toBase64Url(randomBytes(32));
  r.pendingVerifier = verifier;
  const challenge = await sha256Base64Url(verifier);
  const path = language() === "en" ? "/en/account/app/" : "/konto/app/";
  const url = `${r.cloud.webUrl}${path}?app=${encodeURIComponent(r.app)}&challenge=${challenge}`;
  setError(null);
  setNotice(null);
  setPhase("waiting");
  setDialog("signIn");
  lastSignInUrl = url;
  try { await r.platform.openUrl(url); } catch { /* The dialog offers to open it again. */ }
}
let lastSignInUrl: string | null = null;

/** The code arrives through the app's URL scheme, or pasted by hand. */
async function submitCode(raw: string) {
  const r = rt;
  if (!r || !r.pendingVerifier) return;
  const code = extractCode(raw, r.app);
  if (!code) { fail("claim"); return; }
  setError(null);
  setPhase("connecting");
  let token: string;
  try {
    token = await claimSession(r.cloud, code, r.pendingVerifier);
  } catch (caught) {
    setPhase("waiting");
    fail(caught instanceof TypeError ? "network" : "claim");
    return;
  }
  // The code is spent: from here on the session exists, so later failures
  // never send the user back to an expired sign-in.
  r.pendingVerifier = null;
  setDialog(null);
  try {
    await r.secrets.set(SESSION_SECRET, token);
  } catch (caught) {
    console.warn("[account] storing the session failed; it lasts until the app closes", caught);
  }
  await connect(token, null);
}

function extractCode(raw: string, app: string): string | null {
  const text = raw.trim();
  if (/^[A-Za-z0-9_-]{43}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== `agentz-${app}:`) return null;
    const code = url.searchParams.get("code");
    return code && /^[A-Za-z0-9_-]{43}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

function cancelSignIn() {
  if (!rt) return;
  rt.pendingVerifier = null;
  setError(null);
  if (phase() === "waiting" || phase() === "connecting") setPhase("signedOut");
  setDialog(null);
}

async function saveProfile(next: AccountUser) {
  setUser(next);
  await rt?.kv.setAppState(PROFILE_STATE, JSON.stringify(next));
}

// ---- Session ----

async function connect(token: string, known: AccountUser | null) {
  const r = rt;
  if (!r) return;
  r.token = token;
  r.transport?.close();
  // The Convex client loads only for signed-in users.
  const { createConvexTransport } = await import("./transport");
  if (r.signal.aborted || r.token !== token) return;
  r.transport = createConvexTransport(r.cloud, token, () => void expire());
  setPhase("signedIn");
  let current = known;
  try {
    current = await fetchUser(r.cloud, token);
    await saveProfile(current);
  } catch (caught) {
    if (caught instanceof SessionExpiredError) { await expire(); return; }
    // Offline: continue with the cached profile, sync starts when possible.
  }
  if (r.signal.aborted) return;
  // Without any profile yet (offline right after signing in) try again later.
  if (!current) { retryLater(() => connect(token, null)); return; }
  if (!r.adapter) return;
  const state = await readSyncState(r.kv);
  if (state && state.userId !== current.id) {
    setMergeFrom(state.email || null);
    setDialog("merge");
    return;
  }
  await startEngine(current);
}

async function confirmMerge(accept: boolean) {
  setDialog(null);
  const current = user();
  if (!accept || !current || !rt) { await signOut(); return; }
  // The local data now belongs to this account: start a fresh bookkeeping.
  await rt.book.clear();
  await writeSyncState(rt.kv, freshState(current));
  await startEngine(current);
}

function freshState(current: AccountUser): SyncState {
  return { userId: current.id, email: current.email, keyId: CLOUD_FORMAT, deviceId: crypto.randomUUID(), pushed: 0, pulled: 0, lastSyncedAt: null };
}

async function expire() {
  stopEngine();
  if (rt) {
    await rt.secrets.delete(SESSION_SECRET).catch(() => {});
    rt.transport?.close();
    rt.transport = null;
    rt.token = null;
  }
  setPhase("signedOut");
  setNotice("expired");
}

async function signOut() {
  const r = rt;
  if (!r) return;
  // Upload what is still pending, but never block signing out on the network.
  if (r.engine) await withTimeout(r.engine.push(), 3000).catch(() => {});
  stopEngine();
  if (r.token) await revokeSession(r.cloud, r.token).catch(() => {});
  await r.secrets.delete(SESSION_SECRET).catch(() => {});
  r.transport?.close();
  r.transport = null;
  r.token = null;
  await r.kv.setAppState(PROFILE_STATE, "").catch(() => {});
  setUser(null);
  setPhase("signedOut");
  setDialog(null);
}

let retryTimer: ReturnType<typeof setTimeout> | undefined;
function retryLater(run: () => Promise<void>) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (rt && !rt.signal.aborted) void run(); }, 10_000);
}

// ---- Sync engine ----

async function startEngine(current: AccountUser) {
  const r = rt;
  if (!r || !r.transport || !r.adapter || r.signal.aborted) return;
  stopEngine();
  let state = await readSyncState(r.kv);
  if (!state || state.userId !== current.id) {
    await r.book.clear();
    state = freshState(current);
  } else if (state.keyId !== CLOUD_FORMAT) {
    // Synced in another format (end-to-end encrypted): everything goes up again.
    await r.book.clear();
    await r.secrets.delete(LEGACY_KEY_SECRET).catch(() => {});
    state = { ...state, keyId: CLOUD_FORMAT, pushed: 0, pulled: 0 };
  }
  state.email = current.email;
  await writeSyncState(r.kv, state);
  if (r.signal.aborted) return;
  const engine = createSyncEngine({
    app: r.app, adapter: r.adapter, transport: r.transport, book: r.book, kv: r.kv, state,
    onConflictCopy: () => setConflictCopies((n) => n + 1),
  });
  r.engine = engine;
  setSyncReady(true);
  setLastSyncedAt(state.lastSyncedAt);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let failures = 0;
  let stopped = false;
  const schedule = (delay: number) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
  };
  const run = async () => {
    if (stopped) return;
    if (running) { again = true; return; }
    running = true;
    setSyncPhase("syncing");
    try {
      await engine.sync();
      failures = 0;
      setLastSyncedAt(engine.state.lastSyncedAt);
      setSyncPhase("idle");
    } catch (caught) {
      if (caught instanceof SessionExpiredError) { running = false; await expire(); return; }
      console.warn("[account] sync failed", caught);
      failures += 1;
      setSyncPhase(r.transport?.connected() ? "error" : "offline");
      schedule(Math.min(60_000, 5000 * 2 ** Math.min(failures, 4)));
    } finally {
      running = false;
    }
    if (again && !stopped) { again = false; schedule(0); }
  };

  // Local writes: poll the change cursor; upload after a quiet moment.
  let seen = -1;
  let firstSeen = 0;
  const poll = setInterval(async () => {
    if (running || stopped) return;
    try {
      const cursor = await r.adapter!.localCursor();
      if (cursor <= engine.state.pushed) { seen = cursor; firstSeen = 0; return; }
      if (!firstSeen) firstSeen = Date.now();
      if (cursor === seen || Date.now() - firstSeen > QUIET_PUSH_MS) { firstSeen = 0; schedule(0); }
      seen = cursor;
    } catch { /* The next poll tries again. */ }
  }, POLL_MS);
  const settingsPoll = setInterval(() => { if (!running) schedule(0); }, SETTINGS_POLL_MS);
  const unwatch = r.transport.watchHead(r.app, (head) => {
    if (head.rev > engine.state.pulled) schedule(200);
  }, () => { /* Reconnects on its own; failures surface through sync runs. */ });
  const online = () => schedule(0);
  if (typeof window !== "undefined") window.addEventListener("online", online);
  // Closing the window uploads pending changes, but never blocks on the network.
  const unregister = registerFlusher(async () => {
    await withTimeout(engine.push(), 1500).catch(() => {});
  }, "account-sync", "state");

  r.stopEngine = () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(poll);
    clearInterval(settingsPoll);
    unwatch();
    unregister();
    if (typeof window !== "undefined") window.removeEventListener("online", online);
  };
  syncNowHandler = () => schedule(0);
  schedule(0);
}

let syncNowHandler: (() => void) | null = null;

function stopEngine() {
  if (!rt) return;
  rt.stopEngine?.();
  rt.stopEngine = null;
  rt.engine = null;
  syncNowHandler = null;
  setSyncReady(false);
  setSyncPhase("idle");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (caught) => { clearTimeout(timer); reject(caught); });
  });
}

// ---- Runtime ----

export interface AccountRuntimeOptions {
  cloud: CloudConfig;
  /** App ID; also names the URL scheme `agentz-<app>`. */
  app: string;
  platform: PlatformAdapter;
  kv: KvStore;
  adapter?: SyncAdapter;
  /** Defaults to the platform's credential store, else memory. */
  secrets?: SecretStore;
  /** Defaults to the `sync_records` table of the platform database. */
  book?: SyncBook;
}

/** Starts the account for this window; returns the cleanup. */
export function startAccountRuntime(options: AccountRuntimeOptions): () => void {
  const controller = new AbortController();
  const r: Runtime = {
    cloud: options.cloud, app: options.app, platform: options.platform, kv: options.kv,
    secrets: options.secrets ?? options.platform.secrets ?? memorySecrets(),
    adapter: options.adapter,
    book: options.book ?? createSqlSyncBook(() => options.platform.getDb()),
    signal: controller.signal,
    token: null, transport: null, engine: null, pendingVerifier: null, stopEngine: null,
  };
  rt = r;
  setSyncAvailable(!!options.adapter);
  setPhase("signedOut");
  let stopLinks: (() => void) | undefined;
  void (async () => {
    if (options.platform.onOpenUrl) {
      const stop = await options.platform.onOpenUrl((urls) => {
        for (const url of urls) if (extractCode(url, r.app)) void submitCode(url);
      });
      if (controller.signal.aborted) stop();
      else stopLinks = stop;
    }
    const [token, profile] = await Promise.all([
      r.secrets.get(SESSION_SECRET).catch(() => null),
      r.kv.getAppState(PROFILE_STATE).catch(() => null),
    ]);
    if (controller.signal.aborted || !token) return;
    let cached: AccountUser | null = null;
    try { cached = profile ? JSON.parse(profile) as AccountUser : null; } catch { /* refetched below */ }
    if (cached) setUser(cached);
    await connect(token, cached);
  })().catch((caught) => console.warn("[account] start failed", caught));

  return () => {
    controller.abort();
    stopLinks?.();
    stopEngine();
    clearTimeout(retryTimer);
    r.transport?.close();
    if (rt === r) rt = null;
    setPhase("off");
    setUser(null);
    setDialog(null);
    setError(null);
    setSyncAvailable(false);
  };
}

/** Reactive account state and actions for Kit and module UI. */
export const account = {
  phase,
  user,
  syncReady,
  syncPhase,
  lastSyncedAt,
  dialog,
  error,
  notice,
  mergeFrom,
  conflictCopies,
  /** True when the module syncs data (not only signs in). */
  syncAvailable,
  enabled: () => phase() !== "off",
  signedIn: () => phase() === "signedIn",
  signIn,
  /** Opens the sign-in page again while waiting. */
  reopenBrowser: () => { if (rt && lastSignInUrl) void rt.platform.openUrl(lastSignInUrl); },
  submitCode,
  cancelSignIn,
  signOut,
  confirmMerge,
  syncNow: () => syncNowHandler?.(),
  closeDialog: () => {
    if (dialog() === "signIn") { cancelSignIn(); return; }
    if (dialog() === "merge") { void confirmMerge(false); return; }
    setDialog(null);
    setError(null);
  },
  /** Website account page, for profile, password and deletion. */
  manageUrl: () => rt ? `${rt.cloud.webUrl}${language() === "en" ? "/en/account/" : "/konto/"}` : null,
  openManage: () => { const url = account.manageUrl(); if (url && rt) void rt.platform.openUrl(url); },
  dismissNotice: () => setNotice(null),
  clearError: () => setError(null),
};
