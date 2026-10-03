import {
  For, Show, createMemo, createRoot, createSignal, getOwner, onCleanup, onMount,
  runWithOwner, type Owner,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { createModuleI18n, t } from "../i18n";
import { registerFlusher, startRelativeTimeClock } from "../lib";
import { getKvStore, getPlatformAdapter, setPlatformAdapter, setKvStore, applyPlatformToDocument, K } from "../platform";
import { baseSettingsStore, startBaseSettingsRuntime } from "../stores/baseSettings";
import { clearToasts } from "../stores/toasts";
import { shellUi } from "../stores/ui";
import { AppMark, BootErrorScreen, Icon, ToastHost, dismissConfirmDialogs } from "../ui";
import { CommandPalette } from "./CommandPalette";
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

  onMount(async () => {
    try {
      const platform = props.platform ?? getPlatformAdapter();
      const kv = props.kv ?? getKvStore();
      if (props.platform) setPlatformAdapter(platform);
      if (props.kv) setKvStore(kv);
      applyPlatformToDocument();
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
      setRuntime(activeRuntime);
      const registry = createShortcutRegistry(shortcuts, () => runtime()?.shortcutContext?.() ?? "shell", () =>
        shellUi.settingsOpen() || shellUi.paletteOpen() || shellUi.onboardingOpen() ||
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
            <AppMark logo={props.module.logo} appName={props.module.name} size={44} />
            <div class="shell-boot-bar" />
          </div>
        }>
          {(active) => <>
            <div class="shell" classList={{ "is-bare": !sidebarVisible(), "is-focus": shellUi.focused() }}
              data-side={sidebarVisible() ? "on" : "off"}>
              <Show when={sidebarVisible()}>
                <aside class="side" aria-label={t("shell.sidebar.aria")}>
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
                  </div>
                  <Dynamic component={active().sidebar} />
                  {props.footer}
                  <Show when={active().sidebarFooter}>{(Footer) => <Dynamic component={Footer()} />}</Show>
                </aside>
              </Show>
              <main class="shell-main">
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
              shortcuts={shortcuts()} hasOnboarding={!!active().onboarding} />
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
