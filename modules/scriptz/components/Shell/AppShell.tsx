import {
  ErrorBoundary,
  Match,
  Show,
  Suspense,
  Switch,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
  type JSX,
} from "solid-js";
import { api } from "../../lib/api";
import { startCharacterAutoPrune } from "../../lib/characterAutoPrune";
import { startRelativeTimeClock } from "@agentz/kit/lib";
import { startIdeasStore } from "../../stores/ideas";
import { startDailyStatsStore } from "../../stores/dailyStats";
import { ensureWelcomeContent } from "../../lib/welcome";
import { migrateLegacyBlocksOnce } from "../../lib/legacyBlocksMigration";
import { settingsStore, startSettingsRuntime } from "../../stores/settings";
import { navStore, startNavRuntime } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { t } from "../../i18n";
import { AppMark } from "@agentz/kit/ui";
import { BootErrorScreen } from "@agentz/kit/ui";
import { ToastHost } from "@agentz/kit/ui";
import { ScriptsPage } from "../Library/ScriptsPage";
import { libraryPrefs } from "../Library/prefs";
import { TrashPage } from "../Library/TrashPage";
import { CommandPalette } from "../Palette/CommandPalette";
import { ScriptScreen } from "../Script/ScriptScreen";
import { StageUndoToast } from "../Script/StageToast";
import { IdeasPage } from "../Ideas/IdeasPage";
import { QuickCapture } from "../Ideas/QuickCapture";
import { ExportDialog } from "../Export/ExportDialog";
import { SettingsDialog } from "../Settings/SettingsDialog";
import { Onboarding, ONBOARDING_KEY } from "../Onboarding/Onboarding";
import { Sidebar } from "./Sidebar";
import { library, startLibraryData } from "./libraryData";
import { handleGlobalShortcut } from "./shortcuts";
import "../Common/Common.css";
import "./Shell.css";

export interface AppShellProps {
  /** Rendered at the bottom of the sidebar (e.g. the update indicator). */
  sidebarFooterSlot?: JSX.Element;
}

/**
 * ScriptZ's Werkbank shell: boot sequence, sidebar | main layout, route
 * rendering, global shortcuts and the app-wide dialogs. The host adds
 * platform integration (save flush on close, update indicator) around it.
 */
export function AppShell(props: AppShellProps) {
  const [bootReady, setBootReady] = createSignal(false);
  const [bootError, setBootError] = createSignal<Error | null>(null);

  let disposed = false;
  const cleanup = [startSettingsRuntime(), startNavRuntime(), startRelativeTimeClock()];
  // Register cleanup synchronously: async boot may finish after unmount.
  onCleanup(() => {
    disposed = true;
    for (const stop of cleanup.reverse()) stop();
  });

  onMount(async () => {
    try {
      // Independent boot steps run in parallel (each accesses storage);
      // a failure here means storage is unusable -> recovery
      // screen instead of an app that looks empty.
      await Promise.all([
        settingsStore.load(),
        ensureWelcomeContent(),
        navStore.load(),
        uiStore.load(() => !disposed),
        libraryPrefs.load(() => !disposed),
        // Fills the runtime columns of pre-runtime scripts once so the
        // list shows lengths right away. Never blocks the boot.
        api.backfillRuntimeStats().catch((err) => {
          console.warn("[scriptz] runtime backfill skipped", err);
        }),
      ]);
      if (disposed) return;
      // Retired block types -> action, once, before any editor opens a
      // script (an editor save racing the rewrite could lose an edit).
      await migrateLegacyBlocksOnce().catch((err) => {
        console.warn("[scriptz] legacy block migration skipped", err);
      });
      if (disposed) return;
      cleanup.push(startIdeasStore(), startDailyStatsStore(), startLibraryData());
      setBootReady(true);
    } catch (err) {
      if (disposed) return;
      console.error("[scriptz] boot failed", err);
      setBootError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    // First start: onboarding. After bootReady so it doesn't cover the
    // boot screen.
    try {
      const done = await api.getAppState(ONBOARDING_KEY);
      if (!disposed && !done) uiStore.openOnboarding();
    } catch {
      /* non-blocking */
    }
  });

  // Optional character-registry cleanup (settings > characters). Wired
  // after boot so the legacy migration's rewrites never trigger it.
  createEffect(() => {
    if (!bootReady()) return;
    const stop = untrack(() => startCharacterAutoPrune(() => settingsStore.pruneUnusedCharacters()));
    onCleanup(stop);
  });

  // Keep history / "Zuletzt" in sync with the live script list: purged or
  // trashed scripts drop out, renamed ones get their new title.
  createEffect(() => {
    if (!library.scriptsReady()) return;
    const list = library.scripts();
    // Only the script list drives this effect - not the nav signals that
    // reconcile reads and writes.
    untrack(() => {
      navStore.reconcile(new Set(list.map((s) => s.id)));
      for (const r of navStore.recent()) {
        const live = library.script(r.scriptId);
        if (live && live.title !== r.title) navStore.setScriptTitle(r.scriptId, live.title);
      }
    });
  });

  // Focus mode follows the route: entering a script applies its per-script
  // choice (or the default), leaving it always ends focus mode. A fresh
  // "Unbenannt" script stays out of focus so its title field is reachable.
  createEffect(
    on(
      () => (bootReady() ? navStore.activeScriptId() : null),
      (id, prev) => {
        if (!id) {
          if (prev) uiStore.clearFocus();
          return;
        }
        const title =
          library.script(id)?.title ??
          navStore.recent().find((r) => r.scriptId === id)?.title ??
          "";
        if (!title.trim() || title === t("common.untitled")) {
          uiStore.clearFocus();
          return;
        }
        // Ignore a late preference from an old route or disposed shell.
        void uiStore.applyFocusForScript(id, () =>
          !disposed && navStore.activeScriptId() === id,
        );
      },
    ),
  );

  onMount(() => {
    window.addEventListener("keydown", handleGlobalShortcut);
    onCleanup(() => window.removeEventListener("keydown", handleGlobalShortcut));
  });

  const isScript = () => navStore.route().kind === "script";
  const focused = () => isScript() && uiStore.focusMode();
  const sidebarVisible = () => uiStore.sidebarOpen() && !focused();

  return (
    <div class="app-root shell-root">
      <Show
        when={!bootError()}
        fallback={<BootErrorScreen appName="ScriptZ" title={t("boot.error.title")} description={t("boot.error.lede")} error={bootError()!} onRetry={() => window.location.reload()} />}
      >
        <Show when={bootReady()} fallback={<BootScreen />}>
          <div
            class="shell"
            classList={{ "is-bare": !sidebarVisible(), "is-focus": focused() }}
            data-side={sidebarVisible() ? "on" : "off"}
          >
            <Show when={sidebarVisible()}>
              <Sidebar footerSlot={props.sidebarFooterSlot} />
            </Show>
            <main class="shell-main">
              <Switch>
                <Match when={navStore.route().kind === "scripts"}>
                  <ScriptsPage />
                </Match>
                <Match when={navStore.route().kind === "trash"}>
                  <TrashPage />
                </Match>
                <Match when={navStore.route().kind === "ideas"}>
                  <IdeasPage />
                </Match>
                <Match when={navStore.activeScriptId()} keyed>
                  {(scriptId) => (
                    <ErrorBoundary
                      fallback={(err) => (
                        <div class="error-pane">{t("boot.error", { message: String(err) })}</div>
                      )}
                    >
                      <Suspense fallback={<div class="loading-pane">{t("boot.loadingScript")}</div>}>
                        <ScriptScreen scriptId={scriptId} />
                      </Suspense>
                    </ErrorBoundary>
                  )}
                </Match>
              </Switch>
            </main>
          </div>

          <QuickCapture />
          <ExportDialog />
          <SettingsDialog />
          <Onboarding />
          <CommandPalette />
          <ToastHost />
          {/* Undo toast for stage changes made outside the script screen
              (list menu, palette, ⌘⌥→ while the list is shown). */}
          <StageUndoToast />
        </Show>
      </Show>
    </div>
  );
}

function BootScreen() {
  return (
    <div class="shell-boot" aria-busy="true" aria-label={t("common.loading")}>
      <AppMark logo="scriptz" appName="ScriptZ" size={44} />
      <div class="shell-boot-bar" />
    </div>
  );
}

export default AppShell;
