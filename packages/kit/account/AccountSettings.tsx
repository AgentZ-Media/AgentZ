import { Show } from "solid-js";
import { t } from "../i18n";
import { Icon, Row, SectionHead } from "../ui";
import { account } from "./account";
import { Avatar } from "./Avatar";
import { syncStatus } from "./status";

/** Settings section "Account": sign-in, sync state and sign-out. */
export function AccountSettings(props: { appName: string; onClose(): void }) {
  const name = () => account.user()?.name?.trim() || account.user()?.email || "";
  const status = () => syncStatus();
  return (
    <>
      <SectionHead title={t("prefs.account.title")} sub={t("prefs.account.sub")} onClose={props.onClose} />
      <Show when={account.notice() === "expired"}>
        <p class="acc-note" role="status">{t("account.notice.expired")}</p>
      </Show>
      <Show when={account.signedIn()} fallback={
        <div class="acc-pitch">
          <span class="acc-pitch-icon"><Icon name="cloud" size={22} /></span>
          <b>{t("prefs.account.pitchTitle")}</b>
          <p>{t("prefs.account.pitchText", { appName: props.appName })}</p>
          <ul>
            <li><Icon name="shield" />{t("prefs.account.pitch.secure")}</li>
            <li><Icon name="refresh" />{t("prefs.account.pitch.offline")}</li>
            <li><Icon name="user" />{t("prefs.account.pitch.signOut")}</li>
          </ul>
          <div class="acc-actions">
            <button type="button" class="btn accent" onClick={() => void account.signIn()}>{t("account.signIn")}</button>
          </div>
        </div>
      }>
        <div class="acc-who">
          <Avatar name={name()} seed={account.user()?.id} size={44} />
          <span><b>{name()}</b><small>{account.user()?.email}</small></span>
          <button type="button" class="btn sm" onClick={() => void account.signOut()}>{t("account.menu.signOut")}</button>
        </div>
        <Row label={t("prefs.account.sync")} help={<span class={`acc-status is-${status().tone}`}>{status().text}</span>}>
          <Show when={account.syncReady()}>
            <button type="button" class="btn sm" onClick={() => account.syncNow()} disabled={account.syncPhase() === "syncing"}>
              {t("prefs.account.syncNow")}
            </button>
          </Show>
        </Row>
        <Row label={t("prefs.account.manage")} help={t("prefs.account.manageHelp")}>
          <button type="button" class="btn ghost sm" onClick={() => account.openManage()}>{t("prefs.account.open")}</button>
        </Row>
        <p class="acc-foot">{t("prefs.account.signOutHelp")}</p>
      </Show>
    </>
  );
}
