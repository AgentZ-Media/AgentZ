import { For, Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { t } from "../i18n";
import { DialogFrame, Icon } from "../ui";
import { account } from "../account/account";
import {
  MAX_MESSAGE_CHARS, ReportError, collectInfo, reportDraft, sendReport, validEmail,
  type CollectedInfo, type ReportContext, type ReportErrorCode,
} from "./report";

/**
 * "Report a problem": the user's description, an optional contact address
 * for signed-out users and, behind a disclosure, everything the app sends
 * along. Rendered once by the SuiteShell.
 */
export function ReportDialog(props: { open: boolean; onClose(): void; context: ReportContext }) {
  const [info, setInfo] = createSignal<CollectedInfo | null>(null);
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<ReportErrorCode | null>(null);
  const [number, setNumber] = createSignal<number | null>(null);
  const [emailTouched, setEmailTouched] = createSignal(false);

  // Collected fresh on every opening: view, window and errors are of this moment.
  createEffect(on(() => props.open, (open) => {
    if (!open) return;
    setInfo(null);
    setError(null);
    setNumber(null);
    setEmailTouched(false);
    void collectInfo(props.context).then((collected) => { if (props.open) setInfo(collected); });
  }));

  const signedIn = () => account.signedIn() && !!account.user();
  const email = () => (signedIn() ? "" : reportDraft.email().trim());
  const emailInvalid = () => email() !== "" && !validEmail(email());
  const canSend = () => !!reportDraft.message().trim() && !!info() && !sending() && !emailInvalid();

  async function send(event: Event) {
    event.preventDefault();
    setEmailTouched(true);
    const collected = info();
    if (!canSend() || !collected) return;
    setSending(true);
    setError(null);
    try {
      setNumber(await sendReport(props.context, { message: reportDraft.message(), email: email() || undefined, info: collected }));
      reportDraft.clear();
    } catch (caught) {
      setError(caught instanceof ReportError ? caught.code : "generic");
    } finally {
      setSending(false);
    }
  }

  const close = () => { if (!sending()) props.onClose(); };

  return (
    <DialogFrame open={props.open} onClose={close} label={t("report.title")} class="rpt-dlg" closeOnBackdrop={false}>
      <Switch>
        <Match when={number() !== null}>
          <div class="rpt-body rpt-done" role="status">
            <span class="rpt-done-icon"><Icon name="check" size={22} /></span>
            <h2>{t("report.done.title")}</h2>
            <p class="rpt-text">{t("report.done.text", { number: String(number()) })}</p>
            <div class="rpt-actions">
              <button type="button" class="btn accent" data-autofocus onClick={() => props.onClose()}>{t("report.done.close")}</button>
            </div>
          </div>
        </Match>
        <Match when={number() === null}>
          <form class="rpt-body" onSubmit={send}>
            <div class="rpt-head">
              <span class="rpt-icon"><Icon name="report" size={20} /></span>
              <h2>{t("report.title")}</h2>
              <button type="button" class="dlg-esc" onClick={close} aria-label={t("common.close")}><kbd>esc</kbd></button>
            </div>
            <p class="rpt-text">{t("report.lede")}</p>
            <textarea class="field rpt-message" data-autofocus rows={5} maxlength={MAX_MESSAGE_CHARS}
              aria-label={t("report.message.label")} placeholder={t("report.message.placeholder")}
              value={reportDraft.message()} onInput={(event) => reportDraft.setMessage(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send(event); }} />
            <Show when={signedIn()} fallback={
              <label class="rpt-email">
                <span>{t("report.email.label")} <small>{t("report.email.optional")}</small></span>
                <input class="field" type="email" autocomplete="email" spellcheck={false}
                  placeholder={t("report.email.placeholder")} value={reportDraft.email()}
                  onInput={(event) => reportDraft.setEmail(event.currentTarget.value)}
                  onBlur={() => setEmailTouched(true)} aria-invalid={emailTouched() && emailInvalid()} />
                <Show when={emailTouched() && emailInvalid()}><small class="rpt-invalid">{t("report.email.invalid")}</small></Show>
              </label>
            }>
              <p class="rpt-hint">{t("report.account", { email: account.user()!.email })}</p>
            </Show>
            <details class="rpt-details">
              <summary>{t("report.details.summary")}</summary>
              <p>{t("report.details.text")}</p>
              <Show when={info()} fallback={<p class="rpt-hint">{t("report.details.loading")}</p>}>
                {(collected) => <InfoList info={collected()} />}
              </Show>
            </details>
            <Show when={error()}>{(code) => <p class="rpt-error" role="alert">{t(`report.error.${code()}`)}</p>}</Show>
            <div class="rpt-actions">
              <button type="button" class="btn ghost" onClick={close} disabled={sending()}>{t("common.cancel")}</button>
              <button type="submit" class="btn accent" disabled={!canSend()}>
                {sending() ? t("report.sending") : t("report.send")}
              </button>
            </div>
          </form>
        </Match>
      </Switch>
    </DialogFrame>
  );
}

/** The collected part exactly as it is sent. */
function InfoList(props: { info: CollectedInfo }) {
  const rows = () => [
    ["version", props.info.version],
    ["channel", props.info.channel],
    ["os", props.info.os],
    ...Object.entries(props.info.details),
  ];
  return (
    <div class="rpt-info">
      <dl>
        <For each={rows()}>{([key, value]) => <><dt>{key}</dt><dd>{value}</dd></>}</For>
      </dl>
      <Show when={props.info.errors.length} fallback={<p class="rpt-hint">{t("report.details.noErrors")}</p>}>
        <ol class="rpt-errors"><For each={props.info.errors}>{(line) => <li>{line}</li>}</For></ol>
      </Show>
    </div>
  );
}
