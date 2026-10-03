import { onCleanup, onMount } from "solid-js";
import { AppShell } from "@scriptz/core/components/Shell/AppShell";
import { flushAll } from "@scriptz/core/lib/saveFlush";
import { WebDisclaimerBanner } from "./components/WebDisclaimerBanner";
import { StoragePersistedBadge } from "./components/StoragePersistedBadge";

/**
 * Web shell: the shared Werkbank AppShell plus the browser-only glue -
 * the save flush on tab close / reload and the web chrome (disclaimer
 * banner on top, storage-persistence badge in the sidebar footer). The
 * desktop-only gate (< 1024 px) wraps this component in main.tsx.
 */
export default function App() {
  // Counterpart to the desktop app's onCloseRequested hook. `beforeunload`
  // fires before the unload in all major browsers, `pagehide` is iOS
  // Safari's variant. The flush is kicked off but not awaited - browsers
  // ignore preventDefault on beforeunload anyway; the registered flushers
  // have sync fast paths where possible.
  onMount(() => {
    const handler = () => {
      void flushAll(2000);
    };
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", handler);
    onCleanup(() => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler);
    });
  });

  return (
    <AppShell
      platform="web"
      topSlot={<WebDisclaimerBanner />}
      // Sidebar footer: same spot as the desktop update card, so the badge
      // never covers editor chrome (runtime readout, timeline).
      sidebarFooterSlot={<StoragePersistedBadge />}
    />
  );
}
