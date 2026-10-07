import { ErrorBoundary, Show, Suspense, createEffect, on, untrack } from "solid-js";
import type { AppModule, ModuleContext, ModuleRuntime } from "@agentz/kit/shell";
import { startCharacterAutoPrune } from "./lib/characterAutoPrune";
import { startTrashAutoPurge } from "./lib/trashAutoPurge";
import { ensureWelcomeContent } from "./lib/welcome";
import { migrateLegacyBlocksOnce } from "./lib/legacyBlocksMigration";
import { backfillRuntimeStatsOnBoot } from "./lib/runtimeBackfill";
import { settingsStore, startSettingsRuntime } from "./stores/settings";
import { navStore, startNavRuntime } from "./stores/nav";
import { openStore, startOpenStore } from "./stores/open";
import { currentScriptId } from "./stores/peek";
import { finalStageId } from "./lib/stages";
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
import { NewScriptDialog } from "./components/Library/NewScriptDialog";
import { ExportDialog } from "./components/Export/ExportDialog";
import { Onboarding, ONBOARDING_KEY } from "./components/Onboarding/Onboarding";
import { Sidebar, SidebarFooter } from "./components/Shell/Sidebar";
import { library, startLibraryData } from "./components/Shell/libraryData";
import { getScriptzShortcuts } from "./components/Shell/shortcuts";
import { scriptzAbout, scriptzModuleSettings } from "./components/Settings/moduleSettings";
import { createScriptzCommands } from "./components/Palette/commands";
import { agentSettings, startAgentSettingsRuntime } from "./stores/agentSettings";
import { startAgentUiRuntime } from "./stores/agentUi";
import { agentStore, startAgentRuntime } from "./stores/agent";
import { createScriptzSync } from "./stores/sync";
import { AgentOnboarding } from "./components/Agent/AgentOnboarding";
import { MemoryDialog } from "./components/Agent/MemoryDialog";
import { AgentPage } from "./components/AgentMode/AgentPage";
import { ActivityModal } from "./components/Activity/ActivityModal";
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
  ctx.onDispose(startOpenStore(ctx.kv));
  ctx.onDispose(startAgentSettingsRuntime(ctx.kv));
  ctx.onDispose(startAgentUiRuntime());
  await Promise.all([
    settingsStore.load(), agentSettings.load(), ensureWelcomeContent({ kv: ctx.kv, signal: ctx.signal }), navStore.load(),
    uiStore.load(active), libraryPrefs.load(active),
    uiStore.loadSidebarSections(active), libraryPrefs.loadViewModes(active), libraryPrefs.loadIdeaLayout(active),
    backfillRuntimeStatsOnBoot(ctx.kv).catch((error) => console.warn("[scriptz] runtime backfill skipped", error)),
  ]);
  ensureActive();
  // After the navigation: an install without a stored list starts with the
  // scripts it opened last.
  await openStore.load(() => navStore.recent().map((recent) => recent.scriptId), active);
  ensureActive();
  // Never let an editor save race this one-time content migration.
  await migrateLegacyBlocksOnce({ kv: ctx.kv, signal: ctx.signal }).catch((error) => console.warn("[scriptz] legacy block migration skipped", error));
  ensureActive();
  ctx.runOwned(() => {
    ctx.onDispose(startIdeasStore());
    ctx.onDispose(startDailyStatsStore());
    ctx.onDispose(startLibraryData());
    ctx.onDispose(startCharacterAutoPrune(() => settingsStore.pruneUnusedCharacters()));
    ctx.onDispose(startTrashAutoPurge());
    ctx.onDispose(startAgentRuntime(ctx.services));
    createEffect(() => {
      if (!library.scriptsReady()) return;
      const list = library.scripts();
      untrack(() => {
        const live = new Set(list.map((item) => item.id));
        navStore.reconcile(live);
        openStore.reconcile(live);
        openStore.syncStatuses(list, finalStageId(), navStore.activeScriptId(), settingsStore.closeFinishedScripts());
        for (const recent of navStore.recent()) {
          const live = library.script(recent.scriptId);
          if (live && live.title !== recent.title) navStore.setScriptTitle(recent.scriptId, live.title);
        }
      });
    });
    // Whatever the script view shows belongs to the "Open" list (also after
    // back/forward and a restored session); a script that finished while
    // on screen leaves the list once the view moves on.
    createEffect(on(navStore.activeScriptId, (id, previous) => {
      if (id) openStore.add(id);
      if (previous !== id) openStore.leave(previous ?? null);
    }));
    createEffect(on(navStore.activeScriptId, (id, previous) => {
      if (!id) { if (previous) uiStore.clearFocus(); return; }
      const title = library.script(id)?.title ?? navStore.recent().find((recent) => recent.scriptId === id)?.title ?? "";
      if (!title.trim() || title === t("common.untitled")) { uiStore.clearFocus(); return; }
      void uiStore.applyFocusForScript(id, () => active() && navStore.activeScriptId() === id);
    }));
    createEffect(() => ctx.shell.setFocused(navStore.route().kind === "script" && uiStore.focusMode()));
    // A hidden agent leaves no way back into its mode, not even ⌘[.
    createEffect(() => {
      if (!agentStore.available()) untrack(() => navStore.dropAgentRoutes());
    });
    // Connect the agent in the background when it is on (learning needs it).
    createEffect(() => {
      if (agentStore.available() && agentSettings.enabled() && agentSettings.onboarded() && agentStore.status().state === "checking") {
        void agentStore.refreshStatus().then((status) => {
          if (status.state !== "ready") return;
          void agentStore.refreshModels().catch(() => {});
          agentStore.scheduleLearning(8000);
        });
      }
    });
  });
  return {
    routes: [
      { id: "scripts", matches: () => navStore.route().kind === "scripts" || navStore.route().kind === "inbox", component: ScriptsPage },
      { id: "trash", matches: () => navStore.route().kind === "trash", component: TrashPage },
      { id: "ideas", matches: () => navStore.route().kind === "ideas", component: IdeasPage },
      { id: "script", matches: () => navStore.route().kind === "script", component: ScriptRoute },
      { id: "agent", matches: () => navStore.route().kind === "agent", component: AgentPage },
    ],
    sidebar: Sidebar,
    sidebarFooter: SidebarFooter,
    // List headers (PageBar) show the reopen button; the script view uses
    // Mod+\ and the palette, so the shell adds no button of its own.
    revealsSidebar: true,
    overlays: [QuickCapture, NewScriptDialog, ExportDialog, StageUndoToast, AgentOnboarding, MemoryDialog, ActivityModal],
    settings: scriptzModuleSettings,
    commands: createScriptzCommands(ctx.shell),
    commandPlaceholder: () => t("shell.palette.placeholder"),
    shortcuts: getScriptzShortcuts(),
    shortcutContext: () => currentScriptId() ? "editor" : "list",
    onboarding: { key: ONBOARDING_KEY, component: Onboarding },
    sync: createScriptzSync(),
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
