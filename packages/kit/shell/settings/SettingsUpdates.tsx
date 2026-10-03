import { Show } from "solid-js";
import { baseSettingsStore } from "../../stores";
import { getPlatformAdapter } from "../../platform";
import type { UpdatesStore } from "../../platform";
import { t } from "../../i18n";
import { Row, SectionHead, Switch } from "../../ui";



/** Auto-update (desktop only - the dialog hides this section when no
 *  updates store is registered). */
export function SettingsUpdates(props: { updates: UpdatesStore; releasesUrl?: string; onClose(): void }) {
  const u = () => props.updates;
  const isChecking = () => u().manualCheck()?.kind === "checking";
  const openLatestRelease = () => props.releasesUrl && void getPlatformAdapter().openUrl(props.releasesUrl).catch(() => {});

  const statusLabel = () => {
    const stage = u().stage();
    if (stage === "available" || stage === "downloading" || stage === "installing") {
      return t("settings.updates.available", { version: u().available()?.version ?? "" });
    }
    if (stage === "ready") return t("settings.updates.ready");
    if (u().manualCheck()?.kind === "uptodate") return t("settings.updates.upToDate");
    return t("settings.updates.status");
  };
  const statusHelp = () => {
    if (u().stage() === "installing") return t("shell.update.installing");
    if (u().stage() === "downloading") return t("settings.updates.downloading", { progress: u().progress() });
    if (u().manualCheck()?.kind === "error" || u().stage() === "error") return t("settings.updates.checkError");
    return t("prefs.updates.statusHelp");
  };

  return (
    <>
      <SectionHead title={t("prefs.updates.title")} sub={t("settings.updates.sub")} onClose={props.onClose} />
      <Row label={statusLabel()} help={statusHelp()} class={u().stage() === "error" ? "is-error" : undefined}>
        <div class="set-actions">
          <Show when={u().stage() === "available"}>
            <Show when={props.releasesUrl}>
            <button class="btn ghost sm" onClick={openLatestRelease}>
              {t("settings.updates.action.onGithub")}
            </button>
            </Show>
            <button class="btn primary sm" onClick={() => void u().downloadAndInstall()}>
              {t("settings.updates.action.download")}
            </button>
          </Show>
          <Show when={u().stage() === "ready"}>
            <button class="btn primary sm" onClick={() => void u().restart()}>
              {t("settings.updates.action.restart")}
            </button>
          </Show>
          <Show when={u().stage() === "error"}>
            <button class="btn sm" onClick={() => void u().downloadAndInstall()}>
              {t("settings.updates.action.retry")}
            </button>
          </Show>
          <Show when={u().stage() !== "available" && u().stage() !== "ready"}>
            <button
              class="btn sm"
              onClick={() => void u().checkNow()}
              disabled={isChecking() || u().stage() === "downloading" || u().stage() === "installing"}
            >
              {isChecking() ? t("settings.updates.action.checking") : t("settings.updates.action.check")}
            </button>
          </Show>
        </div>
      </Row>
      <Row label={t("settings.updates.enabled.label")} help={t("prefs.updates.enabledHelp")}>
        <Switch
          checked={baseSettingsStore.updateCheckEnabled()}
          onChange={(v) => void baseSettingsStore.setUpdateCheckEnabled(v)}
          label={t("settings.updates.enabled.aria")}
        />
      </Row>
      <Row label={t("settings.updates.hourly.label")} help={t("prefs.updates.hourlyHelp")}>
        <Switch
          checked={baseSettingsStore.hourlyUpdateCheck()}
          disabled={!baseSettingsStore.updateCheckEnabled()}
          onChange={(v) => void baseSettingsStore.setHourlyUpdateCheck(v)}
          label={t("settings.updates.hourly.aria")}
        />
      </Row>
    </>
  );
}
