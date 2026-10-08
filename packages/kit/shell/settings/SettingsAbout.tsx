import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { getBuildInfo, getPlatformAdapter } from "../../platform";
import { t } from "../../i18n";
import { formatAbsolute } from "../../lib";
import { AppMark, Icon, Row, SectionHead } from "../../ui";
import type { AppModule } from "../types";

export function SettingsAbout(props: {
  module: Pick<AppModule, "name" | "logo" | "about">;
  onClose(): void;
  onShowOnboarding?: () => void;
  onReport?: () => void;
}) {
  const [version, setVersion] = createSignal<string | null>(null);
  let active = true;
  onCleanup(() => { active = false; });
  onMount(() => {
    void getPlatformAdapter().getVersion().then((value) => { if (active) setVersion(value); }).catch(() => {});
  });
  const open = (url: string) => void getPlatformAdapter().openUrl(url).catch(() => {});
  const build = getBuildInfo();
  const nightly = build.channel === "nightly";
  const builtAt = build.builtAt ? Date.parse(build.builtAt) : NaN;
  const repository = props.module.about.links.find((link) => link.id === "repository")?.url;
  const commit = build.commit && /^[0-9a-f]{7,40}$/.test(build.commit) ? build.commit : undefined;
  return <>
    <SectionHead title={t("prefs.about.heading", { appName: props.module.name })} sub={props.module.about.description()} onClose={props.onClose} />
    <div class="set-brand">
      <AppMark logo={props.module.logo} appName={props.module.name} size={48} />
      <div><b>{props.module.name}<Show when={nightly}>
        <span class="set-night-pill"><Icon name="moon" size={10} />{t("shell.nightly.badge")}</span>
      </Show></b><small>
        {version() ? t("prefs.about.version", { version: version()! }) : ""}
        {version() ? " · " : ""}{props.module.about.license()}
      </small></div>
    </div>
    <Show when={nightly}>
      <Show when={!Number.isNaN(builtAt)}>
        <Row label={t("prefs.about.built")}><span class="set-about-val">{formatAbsolute(builtAt)}</span></Row>
      </Show>
      <Show when={commit}>{(sha) =>
        <Row label={t("prefs.about.commit")}>
          <Show when={repository} fallback={<span class="set-about-val set-mono">{sha().slice(0, 7)}</span>}>
            <button type="button" class="btn ghost set-mono" onClick={() => open(`${repository}/commit/${sha()}`)}>{sha().slice(0, 7)}</button>
          </Show>
        </Row>
      }</Show>
      <Row label={t("prefs.about.channel")}><span class="set-about-val">{t("prefs.about.channel.nightly")}</span></Row>
    </Show>
    <For each={props.module.about.links}>{(link) =>
      <Row label={link.label()}><button type="button" class={link.id === "repository" ? "btn ghost set-mono" : "btn ghost"} onClick={() => open(link.url)}>{link.text()}</button></Row>
    }</For>
    <Show when={props.onShowOnboarding}>
      <Row label={t("prefs.about.onboarding.label")} help={props.module.about.onboardingHelp?.() ?? t("settings.about.onboarding.help")}>
        <button type="button" class="btn" onClick={() => props.onShowOnboarding?.()}>{t("settings.about.onboarding.button")}</button>
      </Row>
    </Show>
    <Show when={props.onReport}>
      <Row label={t("prefs.report.label")} help={t("prefs.report.help")}>
        <button type="button" class="btn" onClick={() => props.onReport?.()}>{t("prefs.report.action")}</button>
      </Row>
    </Show>
  </>;
}
