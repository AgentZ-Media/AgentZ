import Database from "@tauri-apps/plugin-sql";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrent as getCurrentDeepLinks, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import {
  STABLE_BUILD,
  type BuildInfo,
  type DbConnection,
  type OpenFileResult,
  type Platform,
  type PlatformAdapter,
  type SaveAsOptions,
  type SaveAsResult,
} from "@agentz/kit/platform";

// Map Tauri's OS string to our three-bucket Platform. iOS / Android
// would arrive on Tauri Mobile; for the desktop bundle we collapse
// anything non-Mac/Windows to "linux" so the keyboard + chrome path
// degrades sensibly.
function detectPlatform(): Platform {
  try {
    const p = osPlatform();
    if (p === "macos") return "macos";
    if (p === "windows") return "windows";
    return "linux";
  } catch {
    return "macos";
  }
}

function parentDir(path: string): string | null {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i <= 0) return null;
  return path.slice(0, i);
}

function isAlreadyExistsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already exists|EEXIST|file exists/i.test(msg);
}

async function desktopSaveAs(
  opts: SaveAsOptions,
  bytes: Uint8Array,
): Promise<SaveAsResult> {
  const path = await save({
    defaultPath: opts.suggestedName,
    filters: opts.filters,
  });
  if (!path) {
    return { cancelled: true, path: null };
  }
  const parent = parentDir(path);
  if (parent) {
    try {
      await mkdir(parent, { recursive: true });
    } catch (err) {
      // `recursive: true` should make this idempotent, but plugin-fs
      // surfaces "already exists" on some OS variants. Anything else
      // (permission denied etc.) we want to see - otherwise the
      // writeFile below would fail with a less helpful message.
      if (!isAlreadyExistsError(err)) throw err;
    }
  }
  await writeFile(path, bytes);
  return { cancelled: false, path };
}

async function desktopOpenFile(accept: string): Promise<OpenFileResult | null> {
  // `accept` is web syntax (e.g. ".scriptz,application/x-scriptz+json").
  // We extract the extension list as a filter and ignore MIME entries -
  // Tauri's dialog only understands extension filters.
  const exts = accept
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("."))
    .map((s) => s.slice(1));
  const filters = exts.length > 0 ? [{ name: "Datei", extensions: exts }] : undefined;
  const path = await openDialog({ multiple: false, filters });
  if (!path || Array.isArray(path)) return null;
  const bytes = await readFile(path);
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = i >= 0 ? path.slice(i + 1) : path;
  return { name, bytes };
}

async function desktopPickDirectory(): Promise<string | null> {
  const dir = await openDialog({ directory: true, multiple: false });
  return typeof dir === "string" ? dir : null;
}

async function desktopWriteFileTo(path: string, bytes: Uint8Array): Promise<void> {
  const parent = parentDir(path);
  if (parent) {
    try {
      await mkdir(parent, { recursive: true });
    } catch (err) {
      if (!isAlreadyExistsError(err)) throw err;
    }
  }
  await writeFile(path, bytes);
}

/** Set by the nightly workflow at build time (see `.github/workflows/nightly.yml`).
 *  Local builds and stable releases leave them empty. */
export function readBuildInfo(env: Record<string, unknown> = import.meta.env): BuildInfo {
  if (env.VITE_AGENTZ_BUILD_CHANNEL !== "nightly") return STABLE_BUILD;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  return { channel: "nightly", commit: text(env.VITE_AGENTZ_BUILD_COMMIT), builtAt: text(env.VITE_AGENTZ_BUILD_TIME) };
}

// Lazy plugin-sql connection. Cached, with reset-on-failure so a
// transient open failure doesn't poison every subsequent DB call.
export function createDesktopPlatform(id: string): PlatformAdapter {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new Error("Invalid desktop app ID");
  let dbPromise: Promise<Database> | null = null;
  function loadDesktopDb(): Promise<DbConnection> {
    if (!dbPromise) {
      const pending = Database.load(`sqlite:${id}.db`);
      pending.catch(() => {
        if (dbPromise === pending) dbPromise = null;
      });
      dbPromise = pending;
    }
    return dbPromise as Promise<DbConnection>;
  }

  const tauriAdapter: PlatformAdapter = {
    platform: detectPlatform(),
    supportsDirectoryWrite: true,
    getDb: loadDesktopDb,
    getVersion: () => getVersion(),
    build: readBuildInfo(),
    openUrl: (url) => openUrl(url),
    revealInFolder: (path) => revealItemInDir(path),
    saveDialog: async (opts) => {
      const result = await save(opts);
      return result ?? null;
    },
    saveAs: desktopSaveAs,
    openFile: desktopOpenFile,
    pickDirectory: desktopPickDirectory,
    writeFileTo: desktopWriteFileTo,
    // Keychain (macOS) / Credential Manager (Windows), see crates/agentz-desktop/src/secrets.rs.
    secrets: {
      get: (key) => invoke<string | null>("plugin:agentz-desktop|secret_get", { key }),
      set: (key, value) => invoke("plugin:agentz-desktop|secret_set", { key, value }),
      delete: (key) => invoke("plugin:agentz-desktop|secret_delete", { key }),
    },
    async onOpenUrl(handler) {
      const stop = await onOpenUrl(handler);
      // A URL that launched the app arrives before any listener exists.
      const initial = await getCurrentDeepLinks().catch(() => null);
      if (initial?.length) handler(initial);
      return stop;
    },
  };
  return tauriAdapter;
}
