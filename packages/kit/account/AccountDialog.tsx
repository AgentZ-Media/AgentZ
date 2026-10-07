import { Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { t, tPlural } from "../i18n";
import { pushToast } from "../stores/toasts";
import { confirmDialog, DialogFrame, Icon } from "../ui";
import { getPlatformAdapter } from "../platform";
import { account } from "./account";

/**
 * Dialogs of the account flow: waiting for the browser sign-in, the recovery
 * key (create, rotate, reset), unlocking a new device and moving local data
 * to another account. Rendered once by the SuiteShell.
 */
export function AccountDialog(props: { appName: string }) {
  const kind = () => account.dialog();
  const label = () => {
    switch (kind()) {
      case "signIn": return t("account.dlg.signIn.title");
      case "createKey": return t("account.dlg.key.newTitle");
      case "enterKey": return t("account.dlg.unlock.title");
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
        <Match when={kind() === "createKey"}><RecoveryKeyBody /></Match>
        <Match when={kind() === "enterKey"}><UnlockBody /></Match>
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

function Head(props: { icon: "cloud" | "shield" | "users"; title: string }) {
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

function RecoveryKeyBody() {
  const [saved, setSaved] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const reason = () => account.keyReason();
  const title = () => reason() === "rotate" ? t("account.dlg.key.rotateTitle")
    : reason() === "reset" ? t("account.dlg.key.resetTitle") : t("account.dlg.key.newTitle");
  const text = () => reason() === "rotate" ? t("account.dlg.key.rotateText")
    : reason() === "reset" ? t("account.dlg.key.resetText") : t("account.dlg.key.newText");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account.recoveryText() ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* The key stays selectable. */ }
  };
  const saveFile = async () => {
    const body = t("account.dlg.key.fileText", { email: account.user()?.email ?? "", key: account.recoveryText() ?? "" });
    try {
      await getPlatformAdapter().saveAs(
        { suggestedName: t("account.dlg.key.fileName"), mimeType: "text/plain", filters: [{ name: "Text", extensions: ["txt"] }] },
        new TextEncoder().encode(body),
      );
    } catch { /* Cancelled or not writable; copying still works. */ }
  };
  const confirm = async () => {
    setBusy(true);
    try { await account.confirmRecoverySaved(); } finally { setBusy(false); }
  };
  return (
    <div class="acc-dlg-body">
      <Head icon="shield" title={title()} />
      <p class="acc-text">{text()}</p>
      <div class="acc-key">
        <code>{account.recoveryText()}</code>
        <div class="acc-key-actions">
          <button type="button" class="btn sm" onClick={() => void copy()}>{copied() ? t("account.dlg.key.copied") : t("account.dlg.key.copy")}</button>
          <button type="button" class="btn sm" onClick={() => void saveFile()}>{t("account.dlg.key.save")}</button>
        </div>
      </div>
      <p class="acc-hint">{t("account.dlg.key.warning")}</p>
      <label class="acc-check">
        <input type="checkbox" checked={saved()} onChange={(event) => setSaved(event.currentTarget.checked)} />
        <span>{t("account.dlg.key.confirm")}</span>
      </label>
      <ErrorLine />
      <div class="acc-actions">
        <button type="button" class="btn ghost" onClick={() => account.closeDialog()}>{t("account.dlg.unlock.later")}</button>
        <button type="button" class="btn accent" disabled={!saved() || busy()} onClick={() => void confirm()}>
          {reason() === "rotate" ? t("account.dlg.key.done") : t("account.dlg.key.start")}
        </button>
      </div>
    </div>
  );
}

function UnlockBody() {
  const [value, setValue] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    try { await account.unlock(value()); } finally { setBusy(false); }
  };
  const lost = async () => {
    const ok = await confirmDialog({
      title: t("account.dlg.unlock.lostTitle"), body: t("account.dlg.unlock.lostBody"),
      confirmLabel: t("account.dlg.unlock.lostConfirm"), danger: true,
    });
    if (ok) account.resetCloud();
  };
  return (
    <form class="acc-dlg-body" onSubmit={(event) => void submit(event)}>
      <Head icon="shield" title={t("account.dlg.unlock.title")} />
      <p class="acc-text">{account.keyReason() === "changed" ? t("account.dlg.unlock.changed") : t("account.dlg.unlock.text")}</p>
      <input class="field acc-key-input" value={value()} data-autofocus
        onInput={(event) => { setValue(event.currentTarget.value); account.clearError(); }}
        placeholder={t("account.dlg.unlock.placeholder")} spellcheck={false} autocomplete="off" autocapitalize="characters" />
      <ErrorLine />
      <div class="acc-actions">
        <button type="button" class="btn ghost sm acc-lost" onClick={() => void lost()}>{t("account.dlg.unlock.lost")}</button>
        <span class="acc-sp" />
        <button type="button" class="btn ghost" onClick={() => account.closeDialog()}>{t("account.dlg.unlock.later")}</button>
        <button type="submit" class="btn accent" disabled={!value().trim() || busy()}>{t("account.dlg.unlock.submit")}</button>
      </div>
    </form>
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
