import { Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { t, tPlural } from "../i18n";
import { pushToast } from "../stores/toasts";
import { DialogFrame, Icon } from "../ui";
import { account } from "./account";
import { syncUpdateState } from "./updateAction";

/**
 * Dialogs of the account flow: waiting for the browser sign-in, moving local
 * data to another account and the update this version needs to keep syncing.
 * Rendered once by the SuiteShell.
 */
export function AccountDialog(props: { appName: string }) {
  const kind = () => account.dialog();
  const label = () => {
    switch (kind()) {
      case "signIn": return t("account.dlg.signIn.title");
      case "merge": return t("account.dlg.merge.title");
      case "updateRequired": return t("account.update.title");
      default: return "";
    }
  };
  // Conflict copies are announced once per batch.
  createEffect(on(account.conflictCopies, (count, previous) => {
    if (previous === undefined || count <= previous) return;
    pushToast(tPlural("account.toast.conflict", count - previous), "info", 8000);
  }));
  return (
    <DialogFrame open={kind() !== null} onClose={() => account.closeDialog()} label={label()}
      class="acc-dlg" closeOnBackdrop={false}>
      <Switch>
        <Match when={kind() === "signIn"}><SignInBody appName={props.appName} /></Match>
        <Match when={kind() === "merge"}><MergeBody /></Match>
        <Match when={kind() === "updateRequired"}><UpdateRequiredBody appName={props.appName} /></Match>
      </Switch>
    </DialogFrame>
  );
}

function ErrorLine() {
  return (
    <Show when={account.error()}>
      {(code) => <p class="acc-error" role="alert">{t(`account.error.${code()}` as "account.error.generic")}</p>}
    </Show>
  );
}

function Head(props: { icon: "cloud" | "users" | "refresh"; title: string }) {
  return (
    <div class="acc-dlg-head">
      <span class="acc-dlg-icon"><Icon name={props.icon} size={20} /></span>
      <h2>{props.title}</h2>
      <button type="button" class="dlg-esc" onClick={() => account.closeDialog()} aria-label={t("common.close")}><kbd>esc</kbd></button>
    </div>
  );
}

function SignInBody(props: { appName: string }) {
  const [code, setCode] = createSignal("");
  const connecting = () => account.phase() === "connecting";
  return (
    <div class="acc-dlg-body">
      <Head icon="cloud" title={t("account.dlg.signIn.title")} />
      <p class="acc-text">{t("account.dlg.signIn.text", { appName: props.appName })}</p>
      <p class="acc-wait" role="status">
        <span class="acc-spinner" aria-hidden="true" />
        {connecting() ? t("account.dlg.signIn.connecting") : t("account.dlg.signIn.waiting")}
      </p>
      <ErrorLine />
      <div class="acc-actions">
        <button type="button" class="btn" onClick={() => account.reopenBrowser()} disabled={connecting()}>{t("account.dlg.signIn.reopen")}</button>
        <button type="button" class="btn ghost" onClick={() => account.cancelSignIn()}>{t("common.cancel")}</button>
      </div>
      <details class="acc-paste">
        <summary>{t("account.dlg.signIn.paste", { appName: props.appName })}</summary>
        <p>{t("account.dlg.signIn.pasteHelp")}</p>
        <form class="acc-row" onSubmit={(event) => { event.preventDefault(); void account.submitCode(code()); }}>
          <input class="field" value={code()} onInput={(event) => setCode(event.currentTarget.value)}
            placeholder={t("account.dlg.signIn.pastePlaceholder")} spellcheck={false} autocomplete="off" />
          <button type="submit" class="btn" disabled={!code().trim() || connecting()}>{t("account.dlg.signIn.submit")}</button>
        </form>
      </details>
    </div>
  );
}

function MergeBody() {
  const text = () => {
    const email = account.user()?.email ?? "";
    const previous = account.mergeFrom();
    return previous ? t("account.dlg.merge.text", { previous, email }) : t("account.dlg.merge.textUnknown", { email });
  };
  return (
    <div class="acc-dlg-body">
      <Head icon="users" title={t("account.dlg.merge.title")} />
      <p class="acc-text">{text()}</p>
      <div class="acc-actions">
        <button type="button" class="btn ghost" onClick={() => void account.confirmMerge(false)}>{t("account.dlg.merge.decline")}</button>
        <button type="button" class="btn accent" data-autofocus onClick={() => void account.confirmMerge(true)}>{t("account.dlg.merge.accept")}</button>
      </div>
    </div>
  );
}

/** Shown once per app start when the backend pauses this version's sync. */
function UpdateRequiredBody(props: { appName: string }) {
  const state = () => syncUpdateState(props.appName);
  const text = () => account.syncBlock()?.reason === "format"
    ? t("account.update.textFormat", { appName: props.appName })
    : t("account.update.textVersion", { appName: props.appName });
  const run = () => {
    const action = state().action?.run;
    if (!action) return;
    // Settings open on their own; the banner keeps the topic in view.
    account.closeDialog();
    action();
  };
  return (
    <div class="acc-dlg-body">
      <Head icon="refresh" title={t("account.update.title")} />
      <p class="acc-text">{text()}</p>
      <p class="acc-hint">{t("account.update.keepWorking")}</p>
      <Show when={state().note}>{(note) => <p class="acc-text" role="status">{note()}</p>}</Show>
      <div class="acc-actions">
        <button type="button" class="btn ghost" onClick={() => account.closeDialog()}>{t("account.update.later")}</button>
        <Show when={state().action}>{(action) =>
          <button type="button" class="btn accent" data-autofocus disabled={!action().run} onClick={run}>{action().label}</button>
        }</Show>
      </div>
    </div>
  );
}
