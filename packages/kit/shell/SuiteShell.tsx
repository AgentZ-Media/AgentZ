import {
  For, Show, createEffect, createMemo, createRoot, createSignal, getOwner, onCleanup, onMount,
  runWithOwner, type Owner,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { createModuleI18n, t } from "../i18n";
import { registerFlusher, startRelativeTimeClock } from "../lib";
import { getBuildInfo, getKvStore, getPlatformAdapter, setPlatformAdapter, setKvStore, applyPlatformToDocument, K } from "../platform";
import { baseSettingsStore, startBaseSettingsRuntime } from "../stores/baseSettings";
import { clearToasts } from "../stores/toasts";
import { shellUi } from "../stores/ui";
import { AppMark, BootErrorScreen, Icon, ToastHost, dismissConfirmDialogs } from "../ui";
import { AccountDialog } from "../account/AccountDialog";
import { SyncPausedBanner } from "../account/SyncPausedBanner";
import { account, startAccountRuntime } from "../account/account";
import { ReportDialog } from "../feedback/ReportDialog";
import { ReportPill } from "../feedback/ReportPill";
import { startErrorLog, type ReportContext } from "../feedback/report";
import { CommandPalette } from "./CommandPalette";
import { NavIndicator } from "./NavIndicator";
import { NightSky } from "./NightSky";
import { SideDots } from "./SideDots";
import { SettingsDialog } from "./SettingsDialog";
import { completeOnboarding as persistOnboarding } from "./onboarding";
import { createShellShortcuts, createShortcutRegistry } from "./shortcuts";
import type { ModuleContext, ModuleRuntime, SuiteShellProps } from "./types";

/** A module's asynchronous boot and its synchronous reactive work have one
 * explicit lifetime. No platform calls or listeners are started on import. */
export function SuiteShell(props: SuiteShellProps) {
  const [runtime, setRuntime] = createSignal<ModuleRuntime>();
  const [bootError, setBootError] = createSignal<Error>();
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  let runtimeDisposed = false;
  let activeRuntime: ModuleRuntime | undefined;
  let scopeOwner: Owner | null = null;
  let disposeScope = () => {};
  createRoot((dispose) => {
    disposeScope = dispose;
    scopeOwner = getOwner();
  });
  const onDispose = (cleanup: () => void) => {
    let called = false;
    const once = () => { if (!called) { called = true; cleanup(); } };
    if (controller.signal.aborted) once();
    else cleanups.push(once);
  };
  const disposeRuntime = () => {
    if (!activeRuntime || runtimeDisposed) return;
    runtimeDisposed = true;
    try { activeRuntime.dispose?.(); }
    catch (error) { console.warn("[kit] module cleanup failed", error); }
  };
  const shutdown = () => {
    controller.abort();
    // Stop reactive observers before resource disposers reset shared signals.
    // Teardown must never look like a fresh empty data load to a module.
    try { disposeScope(); } catch (error) { console.warn("[kit] reactive cleanup failed", error); }
    disposeRuntime();
    for (const stop of cleanups.splice(0).reverse()) {
      try { stop(); } catch (error) { console.warn("[kit] cleanup failed", error); }
    }
  };
  shellUi.reset();
  onCleanup(() => { shutdown(); shellUi.reset(); clearToasts(); dismissConfirmDialogs(); });

  // Compose an isolated catalog for this shell; product translators retain
  // their exact compile-time keys while sharing the active language signal.
  const labels = createModuleI18n(props.module.i18n);
  const shortcuts = createMemo(() => [...createShellShortcuts(shellUi), ...(runtime()?.shortcuts ?? [])]);
  const selectedRoute = createMemo(() => runtime()?.routes.find((route) => route.matches()));
  const sidebarVisible = () => shellUi.sidebarOpen() && !shellUi.focused();
  let sidebar: HTMLElement | undefined;
  createEffect(() => {
    if (!sidebarVisible()) {
      // Commit inline edits through blur before leaving the hidden navigation inert.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && sidebar?.contains(focused)) focused.blur();
    }
  });
  // Static per process: a nightly build stays recognizable in every state.
  const nightly = () => (props.platform?.build ?? getBuildInfo()).channel === "nightly";

  onMount(async () => {
    try {
      const platform = props.platform ?? getPlatformAdapter();
      const kv = props.kv ?? getKvStore();
      if (props.platform) setPlatformAdapter(platform);
      if (props.kv) setKvStore(kv);
      applyPlatformToDocument();
      // Recent errors for "Report a problem"; kept in memory only.
      if (props.cloud) onDispose(startErrorLog());
      onDispose(startBaseSettingsRuntime(kv));
      // Shared clock behind relativeTime(); every module gets fresh labels.
      onDispose(startRelativeTimeClock());
      await baseSettingsStore.load();
      if (controller.signal.aborted) return;
      const context: ModuleContext = {
        platform, kv, shell: shellUi, services: props.services ?? {},
        signal: controller.signal, onDispose,
        runOwned<T>(setup: () => T): T {
          if (controller.signal.aborted) throw new DOMException("Module boot cancelled", "AbortError");
          return runWithOwner(scopeOwner, setup)!;
        },
      };
      activeRuntime = await context.runOwned(() => props.module.setup(context));
      if (controller.signal.aborted) { disposeRuntime(); return; }
      if (activeRuntime.flushPending) {
        const flush = activeRuntime.flushPending.bind(activeRuntime);
        onDispose(registerFlusher((timeoutMs) => flush(timeoutMs), `module:${props.module.id}`));
      }
      if (props.cloud) {
        onDispose(startAccountRuntime({ cloud: props.cloud, app: props.module.id, platform, kv, adapter: activeRuntime.sync }));
      }
      setRuntime(activeRuntime);
      const registry = createShortcutRegistry(shortcuts, () => runtime()?.shortcutContext?.() ?? "shell", () =>
        shellUi.settingsOpen() || shellUi.paletteOpen() || shellUi.onboardingOpen() || shellUi.reportOpen() ||
        document.querySelector('[aria-modal="true"]') !== null,
      );
      onDispose(registry.start());
      // A missing marker is non-blocking; a late read cannot reopen a dialog
      // belonging to an already disposed window.
      const onboarding = activeRuntime.onboarding;
      if (onboarding) {
        try {
          const done = await kv.getAppState(onboarding.key);
          if (!controller.signal.aborted && !done) shellUi.openOnboarding();
        } catch { /* onboarding availability does not invalidate boot */ }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("[kit] boot failed", error);
      shutdown();
      setBootError(error instanceof Error ? error : new Error(String(error)));
    }
  });

  // "Report a problem" belongs to signed-in users of every suite app.
  const reportAvailable = () => !!props.cloud && account.signedIn();
  const reportContext: ReportContext = {
    app: props.module.id, appName: props.module.name,
    get platform() { return props.platform ?? getPlatformAdapter(); },
    get kv() { return props.kv ?? getKvStore(); },
    route: () => selectedRoute()?.id,
  };
  const reportPillShown = () => reportAvailable() && baseSettingsStore.reportButton() && !shellUi.focused() && !shellUi.reportOpen();
  // Signing out closes the dialog; the draft stays for the next sign-in.
  createEffect(() => { if (!reportAvailable() && shellUi.reportOpen()) shellUi.closeReport(); });

  async function completeOnboarding() {
    const definition = runtime()?.onboarding;
    if (!definition || controller.signal.aborted) return;
    await persistOnboarding(props.kv ?? getKvStore(), definition.key, () => shellUi.closeOnboarding(), controller.signal);
  }

  return (
    <div class="app-root shell-root">
      <Show when={!bootError()} fallback={
        <BootErrorScreen error={bootError()!} appName={props.module.name}
          title={props.module.boot?.title()} description={props.module.boot?.description()}
          onRetry={() => window.location.reload()} />
      }>
        <Show when={runtime()} fallback={
          <div class="shell-boot" aria-busy="true" aria-label={labels.t("common.loading")}>
            <Show when={nightly()}><NightSky variant="fill" count={70} seed={3} /></Show>
            {/* The mark assembles from its dots, then breathes while setup runs. */}
            <AppMark logo={props.module.logo} appName={props.module.name} size={52} class="shell-boot-mark" />
            <span class="shell-boot-name" aria-hidden="true">{props.module.name}</span>
          </div>
        }>
          {(active) => <>
            <div class="shell" classList={{ "is-bare": !sidebarVisible(), "is-focus": shellUi.focused() }}
              data-side={sidebarVisible() ? "on" : "off"}>
              <aside ref={sidebar} class="side" aria-label={t("shell.sidebar.aria")}
                inert={!sidebarVisible()} aria-hidden={!sidebarVisible()}>
                <Show when={nightly()} fallback={<SideDots />}><NightSky /></Show>
                <NavIndicator root={() => sidebar} />
                <div class="side-top" data-tauri-drag-region>
                  <span class="side-traffic" data-tauri-drag-region aria-hidden="true" />
                  <span class="side-sp" data-tauri-drag-region />
                  <button type="button" class="ic-btn" onClick={() => shellUi.toggleSidebar()}
                    title={t("shell.sidebar.toggle", { hotkey: K("Mod+\\") })}
                    aria-label={t("shell.sidebar.toggleAria")}><Icon name="sidebar" /></button>
                </div>
                <div class="side-app">
                  <AppMark logo={props.module.logo} appName={props.module.name} size={28} />
                  <span class="side-app-name">{props.module.name}</span>
                  <Show when={nightly()}>
                    <button type="button" class="night-badge" onClick={() => shellUi.openSettings("about")}
                      title={t("shell.nightly.title")} aria-label={t("shell.nightly.title")}>
                      <Icon name="moon" size={11} />{t("shell.nightly.badge")}
                    </button>
                  </Show>
                </div>
                <Dynamic component={active().sidebar} />
                {props.footer}
                <Show when={active().sidebarFooter}>{(Footer) => <Dynamic component={Footer()} />}</Show>
              </aside>
              <main class="shell-main">
                <Show when={props.cloud && !shellUi.focused()}><SyncPausedBanner appName={props.module.name} /></Show>
                <Show when={nightly() && !sidebarVisible() && !shellUi.focused()}>
                  <button type="button" class="night-badge shell-night-chip" onClick={() => shellUi.openSettings("about")}
                    title={t("shell.nightly.title")} aria-label={t("shell.nightly.title")}>
                    <Icon name="moon" size={12} />{t("shell.nightly.badge")}
                  </button>
                </Show>
                <Show when={!shellUi.sidebarOpen() && !active().revealsSidebar}>
                  <button type="button" class="btn ghost icon shell-reveal" onClick={() => shellUi.toggleSidebar()}
                    title={t("shell.sidebar.toggle", { hotkey: K("Mod+\\") })}
                    aria-label={t("shell.sidebar.toggleAria")}><Icon name="sidebar" /></button>
                </Show>
                <Show when={selectedRoute()}>{(route) => <Dynamic component={route().component} />}</Show>
              </main>
            </div>
            <For each={active().overlays}>{(Overlay) => <Overlay />}</For>
            <SettingsDialog module={props.module} settings={active().settings} shell={shellUi}
              shortcuts={shortcuts()} hasOnboarding={!!active().onboarding} account={!!props.cloud} report={reportAvailable()} />
            <Show when={props.cloud}><AccountDialog appName={props.module.name} /></Show>
            <Show when={reportPillShown()}><ReportPill appName={props.module.name} onOpen={() => shellUi.openReport()} /></Show>
            <Show when={props.cloud}>
              <ReportDialog open={shellUi.reportOpen() && reportAvailable()} onClose={() => shellUi.closeReport()} context={reportContext} />
            </Show>
            <Show when={active().onboarding}>{(definition) =>
              <Dynamic component={definition().component} open={shellUi.onboardingOpen()} complete={completeOnboarding} />
            }</Show>
            <Show when={active().commands}>{(commands) =>
              <CommandPalette open={shellUi.paletteOpen()} onClose={() => shellUi.closePalette()} commands={commands()} placeholder={active().commandPlaceholder?.()} />
            }</Show>
            <ToastHost />
          </>}
        </Show>
      </Show>
    </div>
  );
}
