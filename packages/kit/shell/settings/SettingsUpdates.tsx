import { createSignal, Show } from "solid-js";
import { baseSettingsStore } from "../../stores";
import { getBuildInfo, getPlatformAdapter, isNightlyVersion } from "../../platform";
import type { UpdatesStore } from "../../platform";
import { t } from "../../i18n";
import { Icon, Modal, Row, SectionHead, Switch } from "../../ui";
import { NightSky } from "../NightSky";

/** Auto-update (desktop only - the dialog hides this section when no
 *  updates store is registered). */
export function SettingsUpdates(props: {
  updates: UpdatesStore;
  appName: string;
  releasesUrl?: string;
  nightlyReleasesUrl?: string;
  onClose(): void;
}) {
  const u = () => props.updates;
  const isChecking = () => u().manualCheck()?.kind === "checking";
  const [confirming, setConfirming] = createSignal(false);
  const nightlyChannel = () => baseSettingsStore.updateChannel() === "nightly";
  // A nightly build on the stable channel waits for the next stable release.
  const leavingNightly = () => getBuildInfo().channel === "nightly" && !nightlyChannel();
  const availableNightly = () => isNightlyVersion(u().available()?.version);
  const releaseUrl = () => availableNightly() ? props.nightlyReleasesUrl : props.releasesUrl;
  const openRelease = () => {
    const url = releaseUrl();
    if (url) void getPlatformAdapter().openUrl(url).catch(() => {});
  };

  const statusLabel = () => {
    const stage = u().stage();
    if (stage === "available" || stage === "downloading" || stage === "installing") {
      return t("settings.updates.available", { version: u().available()?.version ?? "" });
    }
    if (stage === "ready") return t("settings.updates.ready", { version: u().available()?.version ?? "" });
    if (leavingNightly()) return t("settings.updates.nightly.running");
    if (u().manualCheck()?.kind === "uptodate") return t("settings.updates.upToDate");
    return t("settings.updates.status");
  };
  const statusHelp = () => {
    if (u().stage() === "installing") return t("shell.update.installing");
    if (u().stage() === "ready") return t("settings.updates.readyHelp");
    if (u().stage() === "downloading") return t("settings.updates.downloading", { progress: u().progress() });
    if (u().manualCheck()?.kind === "error" || u().stage() === "error") return t("settings.updates.checkError");
    if (u().stage() === "available" && availableNightly()) return t("settings.updates.nightly.availableHelp");
    if (leavingNightly()) return t("settings.updates.nightly.runningHelp");
    return t("prefs.updates.statusHelp");
  };

  const setChannel = async (nightly: boolean) => {
    setConfirming(false);
    await baseSettingsStore.setUpdateChannel(nightly ? "nightly" : "stable");
    if (baseSettingsStore.updateCheckEnabled()) await u().checkNow();
  };
  const onNightlyToggle = (on: boolean) => {
    if (on) setConfirming(true);
    else void setChannel(false);
  };

  return (
    <>
      <SectionHead title={t("prefs.updates.title")} sub={t("settings.updates.sub")} onClose={props.onClose} />
      <Row label={statusLabel()} help={statusHelp()} class={u().stage() === "error" ? "is-error" : undefined}>
        <div class="set-actions">
          <Show when={u().stage() === "available"}>
            <Show when={releaseUrl()}>
            <button class="btn ghost sm" onClick={openRelease}>
              {t("settings.updates.action.onGithub")}
            </button>
            </Show>
            <button class="btn primary sm" classList={{ "set-night-btn": availableNightly() }} onClick={() => void u().download()}>
              {t("settings.updates.action.download")}
            </button>
          </Show>
          <Show when={u().stage() === "ready"}>
            <button class="btn primary sm" onClick={() => void u().restart()}>
              {t("settings.updates.action.restart")}
            </button>
          </Show>
          <Show when={u().stage() === "error"}>
            <button class="btn sm" onClick={() => void u().restart()}>
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
      <Row label={t("settings.updates.auto.label")} help={t("prefs.updates.autoHelp")}>
        <Switch
          checked={baseSettingsStore.autoInstallUpdates()}
          disabled={!baseSettingsStore.updateCheckEnabled()}
          onChange={(v) => void baseSettingsStore.setAutoInstallUpdates(v)}
          label={t("settings.updates.auto.aria")}
        />
      </Row>
      <div class="srow set-night" classList={{ "is-on": nightlyChannel() }}>
        <div>
          <b class="set-night-label">
            {t("settings.updates.nightly.label")}
            <span class="set-night-pill"><Icon name="moon" size={10} />{t("settings.updates.nightly.badge")}</span>
          </b>
          <small>{t("prefs.updates.nightlyHelp")}</small>
        </div>
        <div class="srow-ctl">
          <Switch
            checked={nightlyChannel()}
            disabled={!baseSettingsStore.updateCheckEnabled()}
            onChange={onNightlyToggle}
            label={t("settings.updates.nightly.aria")}
          />
        </div>
      </div>
      <Show when={nightlyChannel()}>
        <p class="set-night-note">
          <Icon name="shield" size={15} />
          <span>{t("settings.updates.nightly.note", { appName: props.appName })}</span>
        </p>
      </Show>
      <NightlyConfirm open={confirming()} onCancel={() => setConfirming(false)} onConfirm={() => void setChannel(true)} />
    </>
  );
}

function NightlyConfirm(props: { open: boolean; onCancel(): void; onConfirm(): void }) {
  return (
    <Modal open={props.open} onClose={props.onCancel} label={t("settings.updates.nightly.confirm.title")} maxWidth={380}
      footer={<>
        <button type="button" class="btn" onClick={() => props.onCancel()}>{t("common.cancel")}</button>
        <button type="button" class="btn btn-primary set-night-btn" onClick={() => props.onConfirm()} autofocus>
          {t("settings.updates.nightly.confirm.action")}
        </button>
      </>}>
      <div class="night-confirm">
        <div class="night-confirm-sky">
          <NightSky variant="fill" count={30} seed={11} moon={false} />
          <span class="night-confirm-moon" />
        </div>
        <h2>{t("settings.updates.nightly.confirm.title")}</h2>
        <p>{t("settings.updates.nightly.confirm.lede")}</p>
        <ul>
          <li><Icon name="bolt" size={15} />{t("settings.updates.nightly.confirm.risk")}</li>
          <li><Icon name="shield" size={15} />{t("settings.updates.nightly.confirm.backup")}</li>
          <li><Icon name="undo" size={15} />{t("settings.updates.nightly.confirm.back")}</li>
        </ul>
      </div>
    </Modal>
  );
}
