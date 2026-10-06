import { t } from "../../i18n";

export interface RecoveryPanelProps {
  broken: string;
  resetting: boolean;
  onOpenSnapshots(): void;
  onReset(): void;
}

/** Shown instead of the editor when the stored content can't be parsed.
 *  The editor stays unmounted so auto-save never overwrites the broken
 *  (but present) content with an empty document. */
export function RecoveryPanel(props: RecoveryPanelProps) {
  return (
    <div class="recovery-panel" role="alert">
      <h3 class="recovery-title">{t("editor.recovery.title")}</h3>
      <p class="recovery-body">{t("editor.recovery.body")}</p>
      <p class="recovery-body muted small">{t("editor.recovery.hint")}</p>
      <div class="recovery-actions">
        <button class="btn primary" onClick={props.onOpenSnapshots}>
          {t("editor.recovery.openSnapshots")}
        </button>
        <button class="btn danger" onClick={props.onReset} disabled={props.resetting}>
          {props.resetting ? t("editor.recovery.resetting") : t("editor.recovery.reset")}
        </button>
      </div>
      <details class="recovery-details">
        <summary>{t("editor.recovery.tech")}</summary>
        <pre class="recovery-raw">{props.broken.slice(0, 4000)}</pre>
      </details>
    </div>
  );
}
