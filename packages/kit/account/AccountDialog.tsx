import { Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { t, tPlural } from "../i18n";
import { pushToast } from "../stores/toasts";
import { DialogFrame, Icon } from "../ui";
import { account } from "./account";

/**
 * Dialogs of the account flow: waiting for the browser sign-in and moving
 * local data to another account. Rendered once by the SuiteShell.
 */
export function AccountDialog(props: { appName: string }) {
  const kind = () => account.dialog();
  const label = () => {
    switch (kind()) {
      case "signIn": return t("account.dlg.signIn.title");
      case "merge": return t("account.dlg.merge.title");
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

function Head(props: { icon: "cloud" | "users"; title: string }) {
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
