import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { getPlatformAdapter } from "../../platform";
import { t } from "../../i18n";
import { AppMark, Row, SectionHead } from "../../ui";
import type { AppModule } from "../types";

export function SettingsAbout(props: {
  module: Pick<AppModule, "name" | "logo" | "about">;
  onClose(): void;
  onShowOnboarding?: () => void;
}) {
  const [version, setVersion] = createSignal<string | null>(null);
  let active = true;
  onCleanup(() => { active = false; });
  onMount(() => {
    void getPlatformAdapter().getVersion().then((value) => { if (active) setVersion(value); }).catch(() => {});
  });
  const open = (url: string) => void getPlatformAdapter().openUrl(url).catch(() => {});
  return <>
    <SectionHead title={t("prefs.about.heading", { appName: props.module.name })} sub={props.module.about.description()} onClose={props.onClose} />
    <div class="set-brand">
      <AppMark logo={props.module.logo} appName={props.module.name} size={48} />
      <div><b>{props.module.name}</b><small>
        {version() ? t("prefs.about.version", { version: version()! }) : ""}
        {version() ? " · " : ""}{props.module.about.license()}
      </small></div>
    </div>
    <For each={props.module.about.links}>{(link) =>
      <Row label={link.label()}><button type="button" class={link.id === "repository" ? "btn ghost set-mono" : "btn ghost"} onClick={() => open(link.url)}>{link.text()}</button></Row>
    }</For>
    <Show when={props.onShowOnboarding}>
      <Row label={t("prefs.about.onboarding.label")} help={props.module.about.onboardingHelp?.() ?? t("settings.about.onboarding.help")}>
        <button type="button" class="btn" onClick={() => props.onShowOnboarding?.()}>{t("settings.about.onboarding.button")}</button>
      </Row>
    </Show>
  </>;
}
