import { createEffect, onCleanup, onMount } from "solid-js";
import { AppShell } from "@scriptz/core/components/Shell/AppShell";
import { flushAll } from "@scriptz/core/lib/saveFlush";
import { settingsStore } from "@scriptz/core/stores/settings";
import { UpdateIndicator } from "./components/Common/UpdateIndicator";
import { updatesStore } from "~/stores/updates";

/**
 * Desktop shell: the shared Werkbank AppShell plus the Tauri-only glue -
 * draining pending saves before the window closes and the auto-updater
 * (background polling + the sidebar indicator).
 */
export default function App() {
  // Window close request -> drain all pending writes before Tauri destroys
  // the window.
  onMount(() => {
    let unlisten: (() => void) | null = null;
    let closing = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        unlisten = await win.onCloseRequested(async (event) => {
          if (closing) return;
          event.preventDefault();
          closing = true;
          try {
            await flushAll(2000);
          } finally {
            try {
              await win.destroy();
            } catch {
              try {
                await win.close();
              } catch {
                /* nothing left */
              }
            }
          }
        });
      } catch (err) {
        console.warn("[scriptz] close-flush hook unavailable", err);
      }
    })();
    onCleanup(() => {
      try {
        unlisten?.();
      } catch {
        /* ignore */
      }
    });
  });

  // The update check runs for the app's lifetime, independent of whether
  // the sidebar (and with it the indicator) is currently visible. It waits
  // for the settings so a disabled update check is respected.
  createEffect(() => {
    if (settingsStore.loaded()) updatesStore.startBackgroundPolling();
  });
  onCleanup(() => updatesStore.stopBackgroundPolling());

  return <AppShell platform="desktop" sidebarFooterSlot={<UpdateIndicator />} />;
}
