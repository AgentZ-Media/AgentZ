// Host capability interfaces shared by product modules.
// Native integrations register an adapter explicitly before application boot.

import { STABLE_BUILD, type BuildInfo } from "./build";

// ===== Host platform =====
//
// The three OS families we care about. iOS / Android map to "linux"
// for now (their webview behaviour is closer to linux than to macos
// for shared UI behavior). Stays sync for the app's lifetime.

export type Platform = "macos" | "windows" | "linux";

// ===== Database connection =====
//
// Structural interface - Tauri's @tauri-apps/plugin-sql Database class
// satisfies this directly, so the desktop adapter can pass its Database
// instance without any wrapper. A future web adapter would implement
// these two methods on top of IndexedDB or sql.js.
export interface DbConnection {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(
    query: string,
    bindValues?: unknown[],
  ): Promise<{ lastInsertId?: number; rowsAffected: number }>;
}

// ===== Save / Open Filter =====

export interface SaveDialogFilter {
  name: string;
  extensions: string[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: SaveDialogFilter[];
}

// ===== File persistence =====
//
// Narrow abstraction for "write a file" / "read a file". Used by
// file export paths. Desktop opens
// a native save/open dialog and writes/reads via plugin-fs; web
// triggers a blob download or shows `<input type="file">`.

export interface SaveAsOptions {
  /** Suggested filename incl. extension. Pre-filled into the save
   *  dialog on desktop, set as the `download` attribute on web. */
  suggestedName: string;
  /** MIME type for the web blob; irrelevant on desktop. */
  mimeType: string;
  /** Optional file type filters for the native dialog. Web ignores. */
  filters?: SaveDialogFilter[];
}

export interface SaveAsResult {
  /** True when the user cancelled the save dialog (desktop). */
  cancelled: boolean;
  /** Absolute path written to - desktop only. Web sets
   *  null because the browser doesn't return a path. */
  path: string | null;
}

export interface OpenFileResult {
  name: string;
  bytes: Uint8Array;
}

// ===== Adapter interface =====

export interface PlatformAdapter {
  /** Operating system this app runs on. Synchronous and static for the
   * app's lifetime - host detects once at startup. */
  platform: Platform;

  /** True when the host can pick a directory and write multiple files into
   *  it (desktop). Web sets false and falls back to per-file blob
   *  downloads. Lets callers select the appropriate export strategy. */
  supportsDirectoryWrite: boolean;

  /** Return a live database connection. May be lazy. */
  getDb(): Promise<DbConnection>;

  /** Read the running app version (e.g. "0.7.3"). */
  getVersion(): Promise<string>;

  /** Build identity, known synchronously at startup. Hosts without it are
   *  treated as stable builds. */
  build?: BuildInfo;

  /** Open an external URL in the user's default browser. */
  openUrl(url: string): Promise<void>;

  /** Reveal the given absolute path in Finder/Explorer. No-op on web. */
  revealInFolder(path: string): Promise<void>;

  /** Native save dialog. Returns the chosen path or null if cancelled.
   *  Lower-level API - if you want to write bytes, use `saveAs`. */
  saveDialog(opts: SaveDialogOptions): Promise<string | null>;

  /** Writes the given bytes as a file. Desktop opens
   *  a save dialog and writes via plugin-fs; web triggers a
   *  blob download (no save dialog in the browser). */
  saveAs(opts: SaveAsOptions, bytes: Uint8Array): Promise<SaveAsResult>;

  /** Reads a file selected by the user. Desktop opens an open dialog
   *  + plugin-fs::readFile; web shows `<input type="file">`. `accept` is
   *  the MIME / extension list for the filter (e.g. ".json,application/json").
   *  Returns null when the user cancels. */
  openFile(accept: string): Promise<OpenFileResult | null>;

  /** Opens a directory picker, returning the chosen absolute path or null
   *  (cancelled). Only meaningful when `supportsDirectoryWrite` is true. */
  pickDirectory(): Promise<string | null>;

  /** Writes bytes to an absolute path, creating parent dirs as needed. Only
   *  valid when `supportsDirectoryWrite` is true; web throws. */
  writeFileTo(path: string, bytes: Uint8Array): Promise<void>;
}

let adapter: PlatformAdapter | null = null;

export function setPlatformAdapter(p: PlatformAdapter): void {
  adapter = p;
}

export function getPlatformAdapter(): PlatformAdapter {
  if (!adapter) {
    throw new Error(
      "Platform adapter not set. The host app must call setPlatformAdapter() before rendering.",
    );
  }
  return adapter;
}

/** Build identity of the registered host; stable without an adapter. */
export function getBuildInfo(): BuildInfo {
  return adapter?.build ?? STABLE_BUILD;
}

/** Write the host platform onto `<html data-platform="...">` so platform-
 * specific CSS rules (traffic-light padding etc.) can take effect, and mark
 * nightly builds with `data-build="nightly"`.
 * No-op in non-DOM environments. Hosts call this at the end of their
 * platform.ts after `setPlatformAdapter()` has completed. */
export function applyPlatformToDocument(): void {
  if (typeof document === "undefined" || !adapter) return;
  const root = document.documentElement;
  root.dataset.platform = adapter.platform;
  if (getBuildInfo().channel === "nightly") root.dataset.build = "nightly";
  else delete root.dataset.build;
}
