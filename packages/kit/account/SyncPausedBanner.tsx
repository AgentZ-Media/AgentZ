import { Show } from "solid-js";
import { t } from "../i18n";
import { Icon } from "../ui";
import { account } from "./account";
import { syncUpdateState } from "./updateAction";

/**
 * Slim band at the top of the main column while the backend pauses this
 * version's sync. Not dismissible: it only goes away with the update (or when
 * the backend lifts the pause). The SuiteShell hides it in focus mode.
 */
export function SyncPausedBanner(props: { appName: string }) {
  const state = () => syncUpdateState(props.appName);
  const text = () => account.syncBlock()?.reason === "format" ? t("account.update.bannerFormat") : t("account.update.bannerVersion");
  return (
    <Show when={account.syncBlock()}>
      <div class="acc-banner" role="status" data-tauri-drag-region>
        <Icon name="refresh" size={14} />
        <span class="acc-banner-t" data-tauri-drag-region>
          <b>{t("account.update.bannerTitle")}</b>
          <span>{state().note ?? text()}</span>
        </span>
        <button type="button" class="btn ghost sm" onClick={() => account.openUpdateDialog()}>{t("account.update.details")}</button>
        <Show when={state().action}>{(action) =>
          <button type="button" class="btn accent sm" disabled={!action().run} onClick={() => action().run?.()}>{action().label}</button>
        }</Show>
      </div>
    </Show>
  );
}
