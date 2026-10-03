/* @refresh reload */
import { render } from "solid-js/web";

// Order is critical:
//
// 1. Set PlatformAdapter (synchronously on import). Core modules use the
//    adapter lazily inside function calls, but anything that already
//    runs at module-load time (e.g. applyPlatformToDocument) expects a
//    registered adapter.
// 2. Import core/lib/api. On load, api.ts registers the SQL-based
//    default adapter and exports the `api` proxy through the slot.
//    Without this import the slot would be empty as soon as any boot
//    code (settingsStore.load etc.) calls `api.getSetting`.
// 3. Set the Dexie StorageAdapter (Phase E) - it overrides the SQL
//    default right after its self-registration. From now on every
//    `api.*` call goes against IndexedDB. On the first write the
//    adapter runs `navigator.storage.persist()` (best-effort, no dialog).
// 4. Only then import the styles (@agentz/design layers, then core's
//    global.css) + App, and the app tree mounts afterwards.
import "./lib/platform";
import "@scriptz/core/lib/api";
import "./adapters/indexeddb";

// Styles: design system first (fonts -> tokens -> legacy aliases ->
// component primitives), then core's global.css, which pulls in the
// ScriptZ tokens (paper geometry, character palette) and the paper font.
import "@agentz/design/fonts.css";
import "@agentz/design/tokens.css";
import "@agentz/design/legacy.css";
import "@agentz/design/components.css";
import "@scriptz/core/styles/global.css";
import App from "./App";
import { DesktopOnlyGate } from "./components/DesktopOnlyGate";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Gate around the app tree: under 1024px viewport width (phones / iPad
// portrait) we render a "please open on desktop" page instead of the
// app. This spares the boot cost (IndexedDB init, editor mount) on
// devices we don't ship the editor for anyway.
render(
  () => (
    <DesktopOnlyGate>
      <App />
    </DesktopOnlyGate>
  ),
  root,
);
