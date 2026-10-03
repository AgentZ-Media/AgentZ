import { Show } from "solid-js";
import { baseSettingsStore } from "@agentz/kit/stores";
import { t } from "@agentz/kit/i18n";
import type { UpdatesStore } from "@agentz/kit/platform";
import "./UpdateIndicator.css";

const MARK = "\u0000";

/**
 * Update card at the bottom of the sidebar (concept `.upd`):
 * "v0.9.0 ist bereit · Neu starten". Hidden while nothing is pending.
 * Background polling is started by the desktop host, not here, so hiding the
 * sidebar doesn't stop the update check.
 */
export function UpdateIndicator(props: { store: UpdatesStore }) {
  const updatesStore = props.store;
  const busy = () => stage() === "downloading" || stage() === "installing";
  const stage = () => updatesStore.stage();
  const version = () => {
    const v = updatesStore.available()?.version;
    return v ? `v${v.replace(/^v/, "")}` : "";
  };

  const onClick = async () => {
    const s = stage();
    if (s === "ready") {
      await updatesStore.restart();
      return;
    }
    if (s === "available" || s === "error") {
      await updatesStore.downloadAndInstall();
    }
  };

  const title = () => {
    const s = stage();
    if (s === "ready") return t("shell.update.title.ready");
    if (s === "installing") return t("shell.update.installing");
    if (s === "downloading") return t("shell.update.title.downloading");
    if (s === "error") return t("shell.update.title.error");
    return t("shell.update.title.available");
  };

  const action = () => {
    const s = stage();
    if (s === "ready") return t("shell.update.action.restart");
    if (s === "error") return t("shell.update.action.retry");
    if (s === "available") return t("shell.update.action.install");
    return "";
  };

  /** Sentence with the version in bold, without markup in the catalog. */
  const text = () => {
    const s = stage();
    if (s === "installing") return <span class="upd-txt">{t("shell.update.installing")}</span>;
    if (s === "downloading") {
      return <span class="upd-txt">{t("shell.update.downloading", { progress: updatesStore.progress() })}</span>;
    }
    if (s === "error") return <span class="upd-txt">{t("shell.update.error")}</span>;
    const key = s === "ready" ? "shell.update.ready" : "shell.update.available";
    const [a, b] = t(key, { version: MARK }).split(MARK);
    return (
      <span class="upd-txt">
        {a}
        <b>{version()}</b>
        {b ?? ""}
      </span>
    );
  };

  return (
    <Show when={baseSettingsStore.updateCheckEnabled() && stage() !== "idle"}>
      <button
        type="button"
        class="upd"
        classList={{ "is-busy": busy(), "is-error": stage() === "error" }}
        onClick={() => void onClick()}
        title={title()}
        disabled={busy()}
      >
        {text()}
        <Show when={action()}>
          <span class="upd-act">{action()}</span>
        </Show>
      </button>
    </Show>
  );
}
