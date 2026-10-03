import { createEffect, onCleanup, onMount } from "solid-js";
import { SuiteShell } from "@agentz/kit/shell";
import { scriptzModule } from "@agentz/scriptz";
import { flushAll } from "@agentz/kit/lib";
import { baseSettingsStore } from "@agentz/kit/stores";
import { UpdateIndicator } from "./components/Common/UpdateIndicator";
import { updatesStore } from "~/stores/updates";

/**
 * Desktop shell: the shared SuiteShell plus the Tauri-only glue -
 * draining pending saves before the window closes and the auto-updater
 * (background polling + the sidebar indicator).
 */
export default function App() {
  // Window close request -> drain all pending writes before Tauri destroys
  // the window.
  onMount(() => {
    let unlisten: (() => void) | null = null;
    let closing = false;
    let disposed = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        if (disposed) return;
        const stop = await win.onCloseRequested(async (event) => {
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
        if (disposed) stop();
        else unlisten = stop;
      } catch (err) {
        console.warn("[scriptz] close-flush hook unavailable", err);
      }
    })();
    onCleanup(() => {
      disposed = true;
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
    if (baseSettingsStore.loaded()) updatesStore.startBackgroundPolling();
  });
  onCleanup(() => updatesStore.stopBackgroundPolling());

  return <SuiteShell module={scriptzModule} footer={<UpdateIndicator />} />;
}
