// Tauri-backed implementation of @agentz/scriptz's PlatformAdapter.
//
// Explicitly registered at app startup from index.tsx, this provides a
// concrete adapter so the module - which only knows the abstract
// DbConnection / SaveDialogOptions / saveAs etc. - has a real
// implementation to call.
//
// All @tauri-apps/* imports live in this file (plus the few other
// remaining desktop-only files: updates.ts, UpdateIndicator.tsx,
// tauri.ts, App.tsx's close handler).
//
// Since phase 2F: no own exportPdf.ts / exportPlaintext.ts anymore.
// The PDF bytes are built by modules/scriptz/lib/exportPdf.ts, the
// plaintext comes from modules/scriptz/lib/lex::extractTeleprompterText.
// Here we only handle the "bytes to disk" part via saveAs.

import Database from "@tauri-apps/plugin-sql";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import {
  applyPlatformToDocument,
  setPlatformAdapter,
  type DbConnection,
  type OpenFileResult,
  type Platform,
  type PlatformAdapter,
  type SaveAsOptions,
  type SaveAsResult,
} from "@agentz/scriptz/lib/platform";

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

// Lazy plugin-sql connection. Cached, with reset-on-failure so a
// transient open failure doesn't poison every subsequent DB call.
let dbPromise: Promise<Database> | null = null;
function loadDesktopDb(): Promise<DbConnection> {
  if (!dbPromise) {
    const p = Database.load("sqlite:scriptz.db");
    p.catch(() => {
      if (dbPromise === p) dbPromise = null;
    });
    dbPromise = p;
  }
  return dbPromise as Promise<DbConnection>;
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

export function registerDesktopPlatform(): void {
  const tauriAdapter: PlatformAdapter = {
    platform: detectPlatform(),
    supportsDirectoryWrite: true,
    getDb: loadDesktopDb,
    getVersion: () => getVersion(),
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
  };
  setPlatformAdapter(tauriAdapter);
  applyPlatformToDocument();
}
