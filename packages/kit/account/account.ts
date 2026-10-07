import { createSignal } from "solid-js";
import { language } from "../i18n";
import { registerFlusher } from "../lib";
import { getBuildInfo, getUpdatesStore, type KvStore, type PlatformAdapter } from "../platform";
import { baseSettingsStore } from "../stores/baseSettings";
import { shellUi } from "../stores/ui";
import { createSqlSyncBook, readSyncState, writeSyncState, type SyncBook, type SyncState } from "./book";
import {
  createDataKey, createRecordCipher, formatRecoveryKey, fromBase64Url, parseRecoveryKey, randomBytes,
  sha256Base64Url, toArrayBuffer, toBase64Url, unwrapDataKey, wrapDataKey, type DataKey,
} from "./crypto";
import { createSyncEngine, type SyncEngine } from "./engine";
import { claimSession, ClientOutdatedError, errorCode, fetchUser, revokeSession, SessionExpiredError } from "./http";
import type { CloudTransport } from "./transport";
import type { AccountUser, CloudConfig, SecretStore, SyncAdapter, SyncBlock, SyncClient } from "./types";

// Account runtime of one app window: browser sign-in, session, the data key
// and the sync engine. All state is exposed as signals on `account`; the
// runtime starts in SuiteShell when the host passes a CloudConfig.

export type AccountPhase = "off" | "signedOut" | "waiting" | "connecting" | "signedIn";
export type KeyPhase = "none" | "checking" | "create" | "enter" | "resetting" | "ready";
export type SyncPhase = "idle" | "syncing" | "offline" | "error";
export type AccountDialogKind = "signIn" | "createKey" | "enterKey" | "merge" | "updateRequired";

const SESSION_SECRET = "account.session";
const KEY_SECRET = "sync.key";
const PROFILE_STATE = "account.profile";
const POLL_MS = 3000;
const SETTINGS_POLL_MS = 30_000;
const QUIET_PUSH_MS = 15_000;

interface StoredKey { userId: string; keyId: string; key: string }

const [phase, setPhase] = createSignal<AccountPhase>("off");
const [user, setUser] = createSignal<AccountUser | null>(null);
const [keyPhase, setKeyPhase] = createSignal<KeyPhase>("none");
const [syncPhase, setSyncPhase] = createSignal<SyncPhase>("idle");
const [lastSyncedAt, setLastSyncedAt] = createSignal<number | null>(null);
const [dialog, setDialog] = createSignal<AccountDialogKind | null>(null);
/** Recovery key shown once while creating or replacing it. */
const [recoveryText, setRecoveryText] = createSignal<string | null>(null);
/** Why the key dialog is open: first device, new device, or a reset elsewhere. */
const [keyReason, setKeyReason] = createSignal<"new" | "rotate" | "reset" | "device" | "changed">("device");
const [error, setError] = createSignal<string | null>(null);
const [notice, setNotice] = createSignal<"expired" | null>(null);
const [mergeFrom, setMergeFrom] = createSignal<string | null>(null);
const [conflictCopies, setConflictCopies] = createSignal(0);
const [syncAvailable, setSyncAvailable] = createSignal(false);
/** Set while the backend pauses this version's sync until it is updated. */
const [syncBlock, setSyncBlock] = createSignal<SyncBlock | null>(null);

/** Error codes shown by the dialogs (texts in the Kit catalog, account.error.*). */
export type AccountError = "network" | "claim" | "wrongKey" | "invalidKey" | "generic";

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
  pendingKey: { dataKey: DataKey; recovery: Uint8Array } | null;
  stopEngine: (() => void) | null;
  /** The update dialog appears once per app start, the banner stays. */
  blockAnnounced: boolean;
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
  await prepareKey(current);
}

async function confirmMerge(accept: boolean) {
  setDialog(null);
  const current = user();
  if (!accept || !current || !rt) { await signOut(); return; }
  // The local data now belongs to this account: start a fresh bookkeeping,
  // keeping what newer app versions wrote so it moves along.
  await rt.book.resetForNewCloud();
  const previous = await readSyncState(rt.kv);
  await writeSyncState(rt.kv, freshState(current, previous?.keyId ?? ""));
  await prepareKey(current);
}

function freshState(current: AccountUser, keyId: string): SyncState {
  return { userId: current.id, email: current.email, keyId, deviceId: crypto.randomUUID(), pushed: 0, pulled: 0, lastSyncedAt: null };
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
  setKeyPhase("none");
  setNotice("expired");
}

async function signOut() {
  const r = rt;
  if (!r) return;
  // Upload what is still pending, but never block signing out on the network.
  if (r.engine && !syncBlock()) await withTimeout(r.engine.push(), 3000).catch(() => {});
  stopEngine();
  if (r.token) await revokeSession(r.cloud, r.token).catch(() => {});
  await r.secrets.delete(SESSION_SECRET).catch(() => {});
  r.transport?.close();
  r.transport = null;
  r.token = null;
  r.pendingKey = null;
  await r.kv.setAppState(PROFILE_STATE, "").catch(() => {});
  setUser(null);
  setPhase("signedOut");
  setKeyPhase("none");
  setDialog(null);
  setRecoveryText(null);
}

// ---- Data key ----

async function storedKey(r: Runtime, userId: string): Promise<DataKey | null> {
  const raw = await r.secrets.get(KEY_SECRET).catch(() => null);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as StoredKey;
    return value.userId === userId ? { keyId: value.keyId, key: fromBase64Url(value.key) } : null;
  } catch {
    return null;
  }
}

async function storeKey(r: Runtime, userId: string, dataKey: DataKey) {
  const value: StoredKey = { userId, keyId: dataKey.keyId, key: toBase64Url(dataKey.key) };
  await r.secrets.set(KEY_SECRET, JSON.stringify(value));
}

async function prepareKey(current: AccountUser) {
  const r = rt;
  if (!r || !r.transport) return;
  setKeyPhase("checking");
  const local = await storedKey(r, current.id);
  let remote;
  try {
    remote = await r.transport.getKey();
  } catch {
    // Offline: work with the local key; the head subscription notices changes.
    if (local) { await startEngine(current, local); return; }
    setKeyPhase("none");
    setSyncPhase("offline");
    retryLater(() => prepareKey(current));
    return;
  }
  if (r.signal.aborted) return;
  if (!remote) {
    const dataKey = createDataKey();
    const recovery = randomBytes(32);
    r.pendingKey = { dataKey, recovery };
    setRecoveryText(formatRecoveryKey(recovery));
    setKeyReason("new");
    setKeyPhase("create");
    setDialog("createKey");
    return;
  }
  if (remote.resetting) {
    setKeyPhase("resetting");
    retryLater(() => prepareKey(current));
    return;
  }
  if (local && local.keyId === remote.keyId) { await startEngine(current, local); return; }
  setKeyReason(local ? "changed" : "device");
  setKeyPhase("enter");
  setDialog("enterKey");
}

let retryTimer: ReturnType<typeof setTimeout> | undefined;
function retryLater(run: () => Promise<void>) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (rt && !rt.signal.aborted) void run(); }, 10_000);
}

/** The user saved the recovery key shown in the dialog. */
async function confirmRecoverySaved() {
  const r = rt;
  const current = user();
  if (!r?.pendingKey || !r.transport || !current) return;
  const { dataKey, recovery } = r.pendingKey;
  setError(null);
  try {
    const wrapped = toArrayBuffer(await wrapDataKey(dataKey, recovery));
    const reason = keyReason();
    if (reason === "rotate") await r.transport.rewrapKey(dataKey.keyId, wrapped);
    else if (reason === "reset") await r.transport.resetKey(dataKey.keyId, wrapped);
    else {
      try {
        await r.transport.createKey(dataKey.keyId, wrapped);
      } catch (caught) {
        // Another device was faster: use its key instead.
        if (errorCode(caught) === "KEY_EXISTS") {
          r.pendingKey = null;
          setRecoveryText(null);
          setDialog(null);
          await prepareKey(current);
          return;
        }
        throw caught;
      }
    }
    await storeKey(r, current.id, dataKey);
    r.pendingKey = null;
    setRecoveryText(null);
    setDialog(null);
    if (reason !== "rotate") {
      stopEngine();
      await startEngine(current, dataKey);
    }
  } catch (caught) {
    fail(caught instanceof TypeError ? "network" : "generic");
  }
}

/** Unlocks the cloud data on this device with the recovery key. */
async function unlock(text: string): Promise<boolean> {
  const r = rt;
  const current = user();
  if (!r?.transport || !current) return false;
  const recovery = parseRecoveryKey(text);
  if (!recovery) { fail("invalidKey"); return false; }
  setError(null);
  try {
    const remote = await r.transport.getKey();
    if (!remote) { await prepareKey(current); return true; }
    const dataKey = await unwrapDataKey(remote.keyId, new Uint8Array(remote.wrapped), recovery).catch(() => null);
    if (!dataKey) { fail("wrongKey"); return false; }
    await storeKey(r, current.id, dataKey);
    setDialog(null);
    await startEngine(current, dataKey);
    return true;
  } catch {
    fail("network");
    return false;
  }
}

/** New recovery key for the same data; the old one stops working. */
function rotateRecoveryKey() {
  const r = rt;
  const current = user();
  if (!r || !current || keyPhase() !== "ready" || !r.engine) return;
  void (async () => {
    const dataKey = await storedKey(r, current.id);
    if (!dataKey) return;
    const recovery = randomBytes(32);
    r.pendingKey = { dataKey, recovery };
    setRecoveryText(formatRecoveryKey(recovery));
    setKeyReason("rotate");
    setDialog("createKey");
  })();
}

/** Lost recovery key: a new key, the cloud copy is replaced by this device's data. */
function resetCloud() {
  const r = rt;
  if (!r || !user()) return;
  const dataKey = createDataKey();
  const recovery = randomBytes(32);
  r.pendingKey = { dataKey, recovery };
  setRecoveryText(formatRecoveryKey(recovery));
  setKeyReason("reset");
  setDialog("createKey");
}

// ---- Sync engine ----

/** Version and sync format of this device, reported with every sync call. */
async function clientOf(r: Runtime, adapter: SyncAdapter): Promise<SyncClient> {
  // "0.0.0" is below every minimum version, so an unknown version never slips through.
  const version = await r.platform.getVersion().catch(() => "0.0.0");
  const build = r.platform.build ?? getBuildInfo();
  return { version, channel: build.development ? "dev" : build.channel, reads: adapter.format.reads, writes: adapter.format.writes };
}

/** The backend does not let this version sync: pause until an update or a policy change. */
function pauseForUpdate(r: Runtime, block: SyncBlock) {
  const changed = JSON.stringify(syncBlock()) !== JSON.stringify(block);
  setSyncBlock(block);
  setSyncPhase("idle");
  // Look for the newest update when the reason changes (an offered one may be
  // too old for it), unless the user turned update checks off.
  const updates = getUpdatesStore();
  const busy = updates?.stage() === "downloading" || updates?.stage() === "installing";
  if (changed && updates && baseSettingsStore.updateCheckEnabled() && !busy) void updates.checkNow();
  if (r.blockAnnounced) return;
  // Never on top of another dialog (shell or product): the banner and the
  // account button say it too.
  const modalOpen = typeof document !== "undefined" && document.querySelector('[aria-modal="true"]') !== null;
  if (dialog() !== null || shellUi.anyDialogOpen() || modalOpen) return;
  r.blockAnnounced = true;
  setDialog("updateRequired");
}

async function startEngine(current: AccountUser, dataKey: DataKey) {
  const r = rt;
  if (!r || !r.transport || !r.adapter || r.signal.aborted) return;
  stopEngine();
  let state = await readSyncState(r.kv);
  if (!state || state.userId !== current.id) {
    await r.book.clear();
    state = freshState(current, dataKey.keyId);
  } else if (state.keyId !== dataKey.keyId) {
    // A new key replaced the cloud copy: everything is uploaded again,
    // including what only this device still holds from newer versions.
    await r.book.resetForNewCloud();
    state = { ...state, keyId: dataKey.keyId, pushed: 0, pulled: 0 };
  }
  state.email = current.email;
  await writeSyncState(r.kv, state);
  const [cipher, client] = await Promise.all([createRecordCipher(dataKey, r.app), clientOf(r, r.adapter)]);
  if (r.signal.aborted || !r.transport) return;
  const transport = r.transport;
  const engine = createSyncEngine({
    app: r.app, adapter: r.adapter, cipher, transport, book: r.book, kv: r.kv, state, client,
    onConflictCopy: () => setConflictCopies((n) => n + 1),
  });
  r.engine = engine;
  setKeyPhase("ready");
  setLastSyncedAt(state.lastSyncedAt);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let failures = 0;
  let stopped = false;
  /** Counts lifted pauses: a rejection from a request older than that is stale. */
  let resumed = 0;
  const schedule = (delay: number) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
  };
  const run = async () => {
    // While paused, only the head subscription can resume the sync.
    if (stopped || syncBlock()) return;
    if (running) { again = true; return; }
    running = true;
    const startedAt = resumed;
    setSyncPhase("syncing");
    try {
      await engine.sync();
      failures = 0;
      setLastSyncedAt(engine.state.lastSyncedAt);
      setSyncPhase("idle");
    } catch (caught) {
      if (caught instanceof SessionExpiredError) { running = false; await expire(); return; }
      if (caught instanceof ClientOutdatedError) {
        running = false;
        again = false;
        if (stopped) return;
        // The pause was lifted while this request ran: try again shortly.
        if (startedAt !== resumed) { schedule(1000); return; }
        pauseForUpdate(r, caught.block);
        return;
      }
      const code = errorCode(caught);
      if (code === "KEY_CHANGED" || code === "NO_KEY") { running = false; await keyChanged(); return; }
      if (code === "DEV_FORMAT_RAISE") {
        console.warn("[account] this development build writes a newer sync format than the account holds; "
          + "test format changes against the dev backend (docs/cloud-sync.md)");
      }
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
    if (running || stopped || syncBlock()) return;
    try {
      const cursor = await r.adapter!.localCursor();
      if (cursor <= engine.state.pushed) { seen = cursor; firstSeen = 0; return; }
      if (!firstSeen) firstSeen = Date.now();
      if (cursor === seen || Date.now() - firstSeen > QUIET_PUSH_MS) { firstSeen = 0; schedule(0); }
      seen = cursor;
    } catch { /* The next poll tries again. */ }
  }, POLL_MS);
  const settingsPoll = setInterval(() => { if (!running && !syncBlock()) schedule(0); }, SETTINGS_POLL_MS);
  const unwatch = transport.watchHead(r.app, client, (head) => {
    if (stopped) return;
    if (head.block) { pauseForUpdate(r, head.block); return; }
    // The policy changed or the account's data went away (key reset).
    if (syncBlock()) {
      resumed += 1;
      setSyncBlock(null);
      if (dialog() === "updateRequired") setDialog(null);
      schedule(0);
    }
    if (head.keyId && head.keyId !== cipher.keyId && !head.resetting) { void keyChanged(); return; }
    if (head.rev > engine.state.pulled) schedule(200);
  }, () => { /* Reconnects on its own; failures surface through sync runs. */ });
  const online = () => schedule(0);
  if (typeof window !== "undefined") window.addEventListener("online", online);
  // Closing the window uploads pending changes, but never blocks on the network.
  const unregister = registerFlusher(async () => {
    if (!syncBlock()) await withTimeout(engine.push(), 1500).catch(() => {});
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
  setSyncPhase("idle");
  setSyncBlock(null);
}

async function keyChanged() {
  const r = rt;
  const current = user();
  stopEngine();
  if (!r || !current) return;
  await r.secrets.delete(KEY_SECRET).catch(() => {});
  await prepareKey(current);
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
    token: null, transport: null, engine: null, pendingVerifier: null, pendingKey: null, stopEngine: null,
    blockAnnounced: false,
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
    setKeyPhase("none");
    setDialog(null);
    setRecoveryText(null);
    setError(null);
    setSyncAvailable(false);
  };
}

/** Reactive account state and actions for Kit and module UI. */
export const account = {
  phase,
  user,
  keyPhase,
  syncPhase,
  lastSyncedAt,
  dialog,
  recoveryText,
  keyReason,
  error,
  notice,
  mergeFrom,
  conflictCopies,
  /** True when the module syncs data (not only signs in). */
  syncAvailable,
  /** Why the backend pauses this version's sync, or null. */
  syncBlock,
  enabled: () => phase() !== "off",
  signedIn: () => phase() === "signedIn",
  signIn,
  /** Opens the sign-in page again while waiting. */
  reopenBrowser: () => { if (rt && lastSignInUrl) void rt.platform.openUrl(lastSignInUrl); },
  submitCode,
  cancelSignIn,
  signOut,
  confirmMerge,
  confirmRecoverySaved,
  unlock,
  rotateRecoveryKey,
  resetCloud,
  syncNow: () => syncNowHandler?.(),
  openKeyDialog: () => { if (keyPhase() === "enter") setDialog("enterKey"); else if (keyPhase() === "create") setDialog("createKey"); },
  openUpdateDialog: () => { if (syncBlock() && dialog() === null) setDialog("updateRequired"); },
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
