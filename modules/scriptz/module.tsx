import { ErrorBoundary, Show, Suspense, createEffect, on, untrack } from "solid-js";
import type { AppModule, ModuleContext, ModuleRuntime } from "@agentz/kit/shell";
import { api } from "./lib/api";
import { startCharacterAutoPrune } from "./lib/characterAutoPrune";
import { ensureWelcomeContent } from "./lib/welcome";
import { migrateLegacyBlocksOnce } from "./lib/legacyBlocksMigration";
import { settingsStore, startSettingsRuntime } from "./stores/settings";
import { navStore, startNavRuntime } from "./stores/nav";
import { uiStore, startUiRuntime } from "./stores/ui";
import { startIdeasStore } from "./stores/ideas";
import { startDailyStatsStore } from "./stores/dailyStats";
import { scriptzCatalogs, t } from "./i18n";
import { ScriptsPage } from "./components/Library/ScriptsPage";
import { TrashPage } from "./components/Library/TrashPage";
import { libraryPrefs, startLibraryPrefs } from "./components/Library/prefs";
import { ScriptScreen } from "./components/Script/ScriptScreen";
import { StageUndoToast } from "./components/Script/StageToast";
import { IdeasPage } from "./components/Ideas/IdeasPage";
import { QuickCapture } from "./components/Ideas/QuickCapture";
import { ExportDialog } from "./components/Export/ExportDialog";
import { Onboarding, ONBOARDING_KEY } from "./components/Onboarding/Onboarding";
import { Sidebar, SidebarFooter } from "./components/Shell/Sidebar";
import { library, startLibraryData } from "./components/Shell/libraryData";
import { getScriptzShortcuts } from "./components/Shell/shortcuts";
import { scriptzAbout, scriptzModuleSettings } from "./components/Settings/moduleSettings";
import { createScriptzCommands } from "./components/Palette/commands";
import "./components/Shell/Shell.css";

/** Plain product description. Stores, timers and storage start only in setup. */
export const scriptzModule: AppModule = {
  id: "scriptz",
  name: "ScriptZ",
  logo: "scriptz",
  about: scriptzAbout,
  boot: { title: () => t("boot.error.title"), description: () => t("boot.error.lede") },
  i18n: scriptzCatalogs,
  setup: setupScriptz,
};

async function setupScriptz(ctx: ModuleContext): Promise<ModuleRuntime> {
  const active = () => !ctx.signal.aborted;
  const ensureActive = () => {
    if (!active()) throw new DOMException("ScriptZ boot cancelled", "AbortError");
  };
  ctx.onDispose(startSettingsRuntime(ctx.kv));
  ctx.onDispose(startNavRuntime(ctx.kv));
  ctx.onDispose(startUiRuntime(ctx.kv));
  ctx.onDispose(startLibraryPrefs(ctx.kv));
  await Promise.all([
    settingsStore.load(), ensureWelcomeContent({ kv: ctx.kv, signal: ctx.signal }), navStore.load(),
    uiStore.load(active), libraryPrefs.load(active),
    api.backfillRuntimeStats().catch((error) => console.warn("[scriptz] runtime backfill skipped", error)),
  ]);
  ensureActive();
  // Never let an editor save race this one-time content migration.
  await migrateLegacyBlocksOnce({ kv: ctx.kv, signal: ctx.signal }).catch((error) => console.warn("[scriptz] legacy block migration skipped", error));
  ensureActive();
  ctx.runOwned(() => {
    ctx.onDispose(startIdeasStore());
    ctx.onDispose(startDailyStatsStore());
    ctx.onDispose(startLibraryData());
    ctx.onDispose(startCharacterAutoPrune(() => settingsStore.pruneUnusedCharacters()));
    createEffect(() => {
      if (!library.scriptsReady()) return;
      const list = library.scripts();
      untrack(() => {
        navStore.reconcile(new Set(list.map((item) => item.id)));
        for (const recent of navStore.recent()) {
          const live = library.script(recent.scriptId);
          if (live && live.title !== recent.title) navStore.setScriptTitle(recent.scriptId, live.title);
        }
      });
    });
    createEffect(on(navStore.activeScriptId, (id, previous) => {
      if (!id) { if (previous) uiStore.clearFocus(); return; }
      const title = library.script(id)?.title ?? navStore.recent().find((recent) => recent.scriptId === id)?.title ?? "";
      if (!title.trim() || title === t("common.untitled")) { uiStore.clearFocus(); return; }
      void uiStore.applyFocusForScript(id, () => active() && navStore.activeScriptId() === id);
    }));
    createEffect(() => ctx.shell.setFocused(navStore.route().kind === "script" && uiStore.focusMode()));
  });
  return {
    routes: [
      { id: "scripts", matches: () => navStore.route().kind === "scripts" || navStore.route().kind === "inbox", component: ScriptsPage },
      { id: "trash", matches: () => navStore.route().kind === "trash", component: TrashPage },
      { id: "ideas", matches: () => navStore.route().kind === "ideas", component: IdeasPage },
      { id: "script", matches: () => navStore.route().kind === "script", component: ScriptRoute },
    ],
    sidebar: Sidebar,
    sidebarFooter: SidebarFooter,
    // List headers (PageBar) show the reopen button; the script view uses
    // Mod+\ and the palette, so the shell adds no button of its own.
    revealsSidebar: true,
    overlays: [QuickCapture, ExportDialog, StageUndoToast],
    settings: scriptzModuleSettings,
    commands: createScriptzCommands(ctx.shell),
    commandPlaceholder: () => t("shell.palette.placeholder"),
    shortcuts: getScriptzShortcuts(),
    shortcutContext: () => navStore.activeScriptId() ? "editor" : "list",
    onboarding: { key: ONBOARDING_KEY, component: Onboarding },
  };
}

function ScriptRoute() {
  return <Show when={navStore.activeScriptId()} keyed>{(scriptId) =>
    <ErrorBoundary fallback={(error) => <div class="error-pane">{t("boot.error", { message: String(error) })}</div>}>
      <Suspense fallback={<div class="loading-pane">{t("boot.loadingScript")}</div>}>
        <ScriptScreen scriptId={scriptId} />
      </Suspense>
    </ErrorBoundary>
  }</Show>;
}
