import { createEffect, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";
import { SuiteShell, type AppModule } from "@agentz/kit/shell";
import { createSqlKvStore, setKvStore, setPlatformAdapter, applyPlatformToDocument, setUpdatesStore } from "@agentz/kit/platform";
import { flushAll } from "@agentz/kit/lib";
import { language, t } from "@agentz/kit/i18n";
import { baseSettingsStore, pushToast, shellUi } from "@agentz/kit/stores";
import { BootErrorScreen } from "@agentz/kit/ui";
import { readCloudConfig } from "@agentz/kit/account";
import { createDesktopPlatform } from "./lib/platform";
import { createEditingLock } from "./lib/editingLock";
import { startDesktopLifecycle } from "./lib/lifecycle";
import { createDesktopUpdates } from "./stores/updates";
import { UpdateIndicator } from "./components/Common/UpdateIndicator";

export interface DesktopAppOptions {
  id: string;
  /** Runs after native services are registered. Loads product CSS and storage. */
  loadModule(): Promise<AppModule>;
  services?: Readonly<Record<string, unknown>>;
}
const runtimeKey = Symbol.for("agentz.desktop.runtime");

export interface DesktopApp {
  ready: Promise<void>;
  dispose(): Promise<void>;
}

/** Explicit native bootstrap. Importing the package does not touch native APIs. */
export function bootDesktopApp(options: DesktopAppOptions): DesktopApp {
  const root = document.getElementById("root");
  if (!root) throw new Error("#root not found");
  const hostRoot = root as HTMLElement & { [runtimeKey]?: DesktopApp };
  const previous = hostRoot[runtimeKey];
  const controller = new AbortController();
  const platform = createDesktopPlatform(options.id);
  const kv = createSqlKvStore(() => platform.getDb());
  const lock = createEditingLock(root);
  // Public backend addresses; VITE_AGENTZ_* overrides point a build elsewhere.
  const cloud = readCloudConfig(import.meta.env) ?? undefined;
  let disposed = false;
  let disposeRender: (() => void) | undefined;
  let stopLifecycle: (() => void) | undefined;
  let disposal: Promise<void> | undefined;
  let shellMounted = false;
  let pendingMenu: { section?: string } | undefined;
  const updates = createDesktopUpdates({
    lockEditing: () => {
      if (disposed || lock.locked()) throw new Error("Desktop is already shutting down");
      return lock.acquire();
    },
    restart: () => relaunch(),
    backupDatabase: async (label) => {
      // Native code owns the backup folder and its retention; SQLite writes a
      // consistent copy through the app's own connection, including WAL pages.
      const path = await invoke<string>("plugin:agentz-desktop|prepare_database_backup", { label });
      const db = await platform.getDb();
      await db.execute("VACUUM INTO $1", [path]);
    },
  });

  const ready = (async () => {
    try {
      // HMR must finish the previous boot/disposal before replacing shared slots.
      if (previous) { await previous.dispose(); await previous.ready; }
      if (disposed) return;
      setPlatformAdapter(platform);
      setKvStore(kv);
      setUpdatesStore(updates.store);
      applyPlatformToDocument();
      const win = getCurrentWindow();
      const stop = await startDesktopLifecycle({
        listenClose: (handler) => win.onCloseRequested(handler),
        listenExit: (handler) => listen<{ requestId: number }>("agentz:exit-requested", (event) => handler(event.payload.requestId)),
        listenMenu: (handler) => listen<string>("agentz:menu-action", (event) => handler(event.payload)),
        ready: () => invoke("plugin:agentz-desktop|ready"),
        finishExit: (requestId, ok) => invoke("plugin:agentz-desktop|finish_exit", { requestId, ok }),
        destroy: () => win.destroy(),
        flush: () => flushAll(2000),
        lockEditing: () => lock.acquire(),
        editingLocked: () => lock.locked(),
        openSettings: (section) => {
          if (shellMounted) shellUi.openSettings(section);
          else pendingMenu = { section };
        },
        failed: (error) => {
          if (error) console.warn("[desktop] close flush failed", error);
          pushToast(t("persistence.saveFailed"), "error");
        },
        confirmUnsaved: (kind) => ask(t("persistence.unsavedBody"), {
          title: t("persistence.unsavedTitle"), kind: "warning",
          okLabel: t(kind === "exit" ? "persistence.unsavedQuit" : "persistence.unsavedClose"),
          cancelLabel: t("common.cancel"),
        }),
      }, controller.signal);
      if (disposed) { stop(); return; }
      stopLifecycle = stop;
      const module = await options.loadModule();
      if (disposed) return;
      if (module.id !== options.id) throw new Error(`Module ID ${module.id} does not match host ${options.id}`);
      function App() {
        createEffect(() => {
          const loaded = baseSettingsStore.loaded();
          baseSettingsStore.updateCheckEnabled();
          baseSettingsStore.hourlyUpdateCheck();
          baseSettingsStore.updateChannel();
          updates.store.stopBackgroundPolling();
          if (loaded) updates.store.startBackgroundPolling();
        });
        createEffect(() => {
          const current = language();
          if (baseSettingsStore.loaded()) {
            void invoke("plugin:agentz-desktop|set_menu_language", { language: current })
              .catch((error) => console.warn("[desktop] menu language update failed", error));
          }
        });
        onCleanup(() => updates.store.stopBackgroundPolling());
        return <SuiteShell module={module} platform={platform} kv={kv} services={options.services} cloud={cloud}
          footer={<UpdateIndicator store={updates.store} />} />;
      }
      disposeRender = render(() => <App />, root);
      shellMounted = true;
      if (pendingMenu) { shellUi.openSettings(pendingMenu.section); pendingMenu = undefined; }
    } catch (error) {
      if (disposed) return;
      console.error("[desktop] boot failed", error);
      // Native lifecycle remains available so a boot-error window can still quit.
      disposeRender = render(() => <BootErrorScreen appName={options.id}
        error={error instanceof Error ? error : new Error(String(error))}
        onRetry={() => window.location.reload()} />, root);
    }
  })();

  const app: DesktopApp = {
    ready,
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      controller.abort();
      const unlock = lock.acquire();
      disposal = (async () => {
        // Also cancels a pending module import before it can mount a new root.
        updates.dispose();
        stopLifecycle?.();
        try {
          const result = await flushAll(2000);
          if (!result.ok) console.warn("[desktop] pending writes remain after disposal", result.failed);
        } finally {
          disposeRender?.();
          unlock();
        }
      })();
      return disposal;
    },
  };
  hostRoot[runtimeKey] = app;
  return app;
}
