// Web implementation of @scriptz/core's PlatformAdapter.
//
// Mirror of apps/desktop/src/lib/platform.ts, but without any
// @tauri-apps/* imports. Imported once at app start from main.tsx;
// registers itself via setPlatformAdapter() before any core module
// accesses the slot.
//
// getDb() throws here on purpose - the web app registers its own
// StorageAdapter (apps/web/src/adapters/indexeddb.ts) that fully
// replaces the SQL layer. getDb() must therefore never be called.
// If it is, that's a hint that somewhere in core a direct DB call is
// still happening instead of an adapter call.
//
// Since Phase 2F: saveAs (blob download) and openFile (<input type="file">)
// provide file persistence. The export dialog can thus write PDF + plaintext
// + .scriptz in the web app without paths having to be modeled.

import {
  applyPlatformToDocument,
  setPlatformAdapter,
  type OpenFileResult,
  type Platform,
  type PlatformAdapter,
  type SaveAsOptions,
  type SaveAsResult,
} from "@scriptz/core/lib/platform";

function detectPlatform(): Platform {
  // userAgentData is the future-proof variant (Chromium-only, 2025+).
  // If not available: derive from userAgent - the platform string has
  // been stable there for years.
  const uaData = (
    navigator as Navigator & {
      userAgentData?: { platform?: string };
    }
  ).userAgentData;
  const raw = (uaData?.platform || navigator.userAgent || "").toLowerCase();
  if (raw.includes("mac")) return "macos";
  if (raw.includes("win")) return "windows";
  return "linux";
}

// Blob download via <a download>. Depending on the setting, the browser
// will ask the user where to save (Chrome/Edge with "ask where to save",
// Safari by default). We don't see the final path - hence path: null
// in SaveAsResult.
function blobDownload(name: string, mimeType: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    // Some browsers need the anchor in the DOM for click() to trigger.
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // With a delay so the download stream doesn't break before the
    // browser has really snapshotted the bytes. The browser holds the
    // blob reference itself in parallel.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

// File open via a hidden <input type="file">. Cancel detection via
// window focus: `change` only fires on an actual selection, not on
// dialog cancellation. We wait 250ms after focus returns, and if no
// change has come in by then we resolve with null.
function inputFileOpen(accept: string): Promise<OpenFileResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      window.removeEventListener("focus", onFocus);
      input.remove();
    };
    const settle = (v: OpenFileResult | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(v);
    };

    const onFocus = () => {
      setTimeout(() => settle(null), 250);
    };
    window.addEventListener("focus", onFocus, { once: true });

    input.addEventListener("change", async () => {
      const file = input.files?.[0] ?? null;
      if (!file) {
        settle(null);
        return;
      }
      try {
        const buf = await file.arrayBuffer();
        settle({ name: file.name, bytes: new Uint8Array(buf) });
      } catch {
        settle(null);
      }
    });
    input.click();
  });
}

const webAdapter: PlatformAdapter = {
  platform: detectPlatform(),
  supportsDirectoryWrite: false,
  async getDb() {
    throw new Error(
      "Web-Build: getDb() ist nicht verfügbar. Der Storage-Adapter " +
        "(apps/web/src/adapters/indexeddb.ts) ersetzt die SQL-Schicht komplett.",
    );
  },
  async getVersion() {
    // Auto-synced with apps/desktop/package.json - vite.config.ts reads
    // the value there at build time and injects it as __APP_VERSION__.
    // Settings renders "ScriptZ · v{appVersion()}", and that should be
    // identical on web and desktop - every tag-push release thereby
    // updates the web display without extra effort.
    return __APP_VERSION__;
  },
  async openUrl(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async revealInFolder() {
    // No Finder-style reveal in the browser. No-op so callers
    // (e.g. after an export) don't break.
  },
  async saveDialog() {
    // No native save dialog in the browser. Whoever wants to write
    // bytes uses saveAs - that triggers a blob download.
    return null;
  },
  async saveAs(opts: SaveAsOptions, bytes: Uint8Array): Promise<SaveAsResult> {
    blobDownload(opts.suggestedName, opts.mimeType, bytes);
    // The browser decides where the file ends up (often Downloads/).
    // cancelled stays false - we can't cancel the download synchronously.
    return { cancelled: false, path: null };
  },
  openFile: inputFileOpen,
  async pickDirectory() {
    return null; // No directory picker in the browser.
  },
  async writeFileTo() {
    throw new Error("writeFileTo is not available in the web build");
  },
};

setPlatformAdapter(webAdapter);
applyPlatformToDocument();

// Mark the browser shell explicitly. The `data-platform` attribute stays
// on the real OS (so Mac users in the browser keep seeing ⌘ labels and
// `isMac()` works correctly), but `data-shell="web"` disables the macOS
// trafficlight padding in tokens.css - no trafficlights in the browser,
// so no spacer for them either.
if (typeof document !== "undefined") {
  document.documentElement.dataset.shell = "web";
}
