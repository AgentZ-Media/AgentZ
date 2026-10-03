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
import { dailyStatsBus } from "../../lib/dailyStatsBus";
import { ensureWelcomeContent } from "../../lib/welcome";
import { migrateLegacyBlocksOnce } from "../../lib/legacyBlocksMigration";
import { settingsStore } from "../../stores/settings";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { t } from "../../i18n";
import { AppMark } from "../Common/AppMark";
import { BootErrorScreen } from "../Common/BootErrorScreen";
import { ToastHost } from "../Common/ToastHost";
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
import { library, markLibraryReady } from "./libraryData";
import { handleGlobalShortcut } from "./shortcuts";
import "../Common/Common.css";
import "./Shell.css";

export interface AppShellProps {
  platform: "desktop" | "web";
  /** Full-width row above the shell (web: disclaimer banner). */
  topSlot?: JSX.Element;
  /** Rendered at the bottom of the sidebar (desktop: update indicator,
   *  web: storage-persistence badge). */
  sidebarFooterSlot?: JSX.Element;
}

/**
 * The Werkbank shell shared by desktop and web: boot sequence, sidebar |
 * main layout, route rendering, global shortcuts and the app-wide dialogs.
 * The host apps only add their platform glue (save flush on close, update
 * indicator, web chrome) around it.
 */
export function AppShell(props: AppShellProps) {
  const [bootReady, setBootReady] = createSignal(false);
  const [bootError, setBootError] = createSignal<Error | null>(null);

  onMount(async () => {
    try {
      // Independent boot steps run in parallel (each is an IPC / IndexedDB
      // roundtrip); a failure here means storage is unusable -> recovery
      // screen instead of an app that looks empty.
      await Promise.all([
        settingsStore.load(),
        ensureWelcomeContent(),
        navStore.load(),
        uiStore.load(),
        libraryPrefs.load(),
        // Fills the runtime columns of pre-runtime scripts once so the
        // list shows lengths right away. Never blocks the boot.
        api.backfillRuntimeStats().catch((err) => {
          console.warn("[scriptz] runtime backfill skipped", err);
        }),
      ]);
      // Retired block types -> action, once, before any editor opens a
      // script (an editor save racing the rewrite could lose an edit).
      await migrateLegacyBlocksOnce().catch((err) => {
        console.warn("[scriptz] legacy block migration skipped", err);
      });
      markLibraryReady();
      setBootReady(true);
    } catch (err) {
      console.error("[scriptz] boot failed", err);
      setBootError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    // First start: onboarding. After bootReady so it doesn't cover the
    // boot screen.
    try {
      const done = await api.getAppState(ONBOARDING_KEY);
      if (!done) uiStore.openOnboarding();
    } catch {
      /* non-blocking */
    }
  });

  // Writing counter + week line: first stats load after boot.
  createEffect(() => {
    if (bootReady()) dailyStatsBus.bump();
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
        void uiStore.applyFocusForScript(id).then(() => {
          // A slow app_state read must not apply a stale script's choice.
          const now = navStore.activeScriptId();
          if (now && now !== id) void uiStore.applyFocusForScript(now);
        });
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
    <div class="app-root shell-root" data-shell-platform={props.platform}>
      <Show
        when={!bootError()}
        fallback={<BootErrorScreen error={bootError()!} onRetry={() => window.location.reload()} />}
      >
        <Show when={bootReady()} fallback={<BootScreen />}>
          {props.topSlot}
          <div
            class="shell"
            classList={{ "is-bare": !sidebarVisible(), "is-focus": focused() }}
            data-side={sidebarVisible() ? "on" : "off"}
          >
            <Show when={sidebarVisible()}>
              <Sidebar platform={props.platform} footerSlot={props.sidebarFooterSlot} />
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
      <AppMark size={44} />
      <div class="shell-boot-bar" />
    </div>
  );
}

export default AppShell;
