import { createSignal, Show } from "solid-js";
import { LOGOS, type LogoId } from "@agentz/design/logo";
import { createModuleI18n } from "@agentz/kit/i18n";
import type { KvStore, PlatformAdapter } from "@agentz/kit/platform";
import type { AppModule, ModuleContext } from "@agentz/kit/shell";
import { Modal, Row, SectionHead, Switch } from "@agentz/kit/ui";

export const fixtureCatalogs = {
  de: {
    "fixture.title": "Ein eigenständiges Modul",
    "fixture.description": "Diese kleine Anwendung verwendet ausschließlich das gemeinsame Kit und Designsystem.",
    "fixture.settings": "Beispiel",
    "fixture.preference": "Zusätzliche Hinweise",
    "fixture.overlay": "Hinweis öffnen",
    "fixture.overlayTitle": "Ein Modul-Overlay",
    "fixture.overlayText": "Dieses Fenster wird vom Modul bereitgestellt und vom gemeinsamen Shell gerendert.",
    "fixture.shortcut": "Modul-Hinweis öffnen",
    "fixture.home": "Übersicht",
    "fixture.preferences": "Einstellungen öffnen",
  },
  en: {
    "fixture.title": "An independent module",
    "fixture.description": "This small application uses only the shared kit and design system.",
    "fixture.settings": "Example",
    "fixture.preference": "Additional hints",
    "fixture.overlay": "Open notice",
    "fixture.overlayTitle": "A module overlay",
    "fixture.overlayText": "This dialog is supplied by the module and rendered by the shared shell.",
    "fixture.shortcut": "Open module notice",
    "fixture.home": "Overview",
    "fixture.preferences": "Open settings",
  },
};

export function createFixtureKv(initial: Record<string, string> = {}) {
  const settings = new Map(Object.entries({ theme: "light", language: "de", ...initial }));
  const state = new Map<string, string>();
  const kv: KvStore = {
    async getSetting(key) { return settings.get(key) ?? null; },
    async setSetting(key, value) { settings.set(key, value); },
    async getAppState(key) { return state.get(key) ?? null; },
    async setAppState(key, value) { state.set(key, value); },
  };
  return { kv, settings, state };
}

/** Deliberately has no database: shell services must use the supplied KV store. */
export const fixturePlatform: PlatformAdapter = {
  platform: "linux",
  supportsDirectoryWrite: false,
  async getDb() { throw new Error("The independent fixture has no database"); },
  async getVersion() { return "0.0.0-fixture"; },
  async openUrl() {},
  async revealInFolder() {},
  async saveDialog() { return null; },
  async saveAs() { return { cancelled: true, path: null }; },
  async openFile() { return null; },
  async pickDirectory() { return null; },
  async writeFileTo() { throw new Error("No filesystem in fixture"); },
};

export function createFixtureModule(options: {
  onSetup?: (context: ModuleContext) => void;
  onDispose?: () => void;
  onRegisteredCleanup?: () => void;
} = {}): AppModule {
  const { t } = createModuleI18n(fixtureCatalogs);
  return {
    id: "fixture",
    name: "Kit Lab",
    logo: Object.keys(LOGOS)[0] as LogoId,
    i18n: fixtureCatalogs,
    about: {
      description: () => t("fixture.description"),
      license: () => "MIT",
      links: [],
    },
    async setup(context) {
      options.onSetup?.(context);
      context.onDispose(() => options.onRegisteredCleanup?.());
      const initialHints = await context.kv.getSetting("fixture.hints");
      if (context.signal.aborted) throw new DOMException("Disposed", "AbortError");
      return context.runOwned(() => {
        const [noticeOpen, setNoticeOpen] = createSignal(false);
        const [hints, setHints] = createSignal(initialHints === "1");
        return {
          routes: [{
            id: "home",
            matches: () => true,
            component: () => <section class="fixture-page">
              <span class="pill">Kit Lab</span>
              <h1>{t("fixture.title")}</h1>
              <p>{t("fixture.description")}</p>
              <div class="fixture-actions">
                <button class="btn" onClick={() => context.shell.openSettings("fixture")}>
                  {t("fixture.preferences")}
                </button>
                <button class="btn" onClick={() => setNoticeOpen(true)}>{t("fixture.overlay")}</button>
              </div>
              <Show when={hints()}><p data-testid="fixture-hint">{t("fixture.preference")}</p></Show>
            </section>,
          }],
          sidebar: () => <button class="fixture-nav" onClick={() => context.shell.closeSettings()}>{t("fixture.home")}</button>,
          settings: { sections: [{
            id: "fixture",
            label: () => t("fixture.settings"),
            icon: "gear",
            component: (props) => <>
              <SectionHead title={t("fixture.settings")} sub={t("fixture.description")} onClose={props.onClose} />
              <div class="set-body"><Row label={t("fixture.preference")}>
                <Switch label={t("fixture.preference")} checked={hints()} onChange={(enabled) => {
                  setHints(enabled);
                  void context.kv.setSetting("fixture.hints", enabled ? "1" : "0");
                }} />
              </Row></div>
            </>,
          }] },
          overlays: [() => <Modal open={noticeOpen()} title={t("fixture.overlayTitle")} onClose={() => setNoticeOpen(false)}>
            <p>{t("fixture.overlayText")}</p>
          </Modal>],
          shortcuts: [{
            id: "fixture.notice",
            label: () => t("fixture.shortcut"),
            group: { id: "fixture", label: () => t("fixture.settings") },
            keys: ["Mod+Shift+Y"],
            contexts: ["shell"],
            matches: (event) => (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "y",
            run: () => setNoticeOpen(true),
          }],
          commands: () => [{ id: "fixture.notice", label: t("fixture.overlay"), run: () => { setNoticeOpen(true); } }],
          dispose: options.onDispose,
        };
      });
    },
  };
}
