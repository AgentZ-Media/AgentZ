import { createSignal, Show } from "solid-js";
import { t } from "../i18n";

export interface BootErrorScreenProps {
  error: Error;
  appName: string;
  title?: string;
  description?: string;
  onRetry(): void;
}

export function BootErrorScreen(props: BootErrorScreenProps) {
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const message = () => props.error.message || String(props.error);
  return (
    <div class="boot-error-screen">
      <div class="boot-error-inner">
        <div class="boot-error-icon" aria-hidden="true">⚠</div>
        <h1 class="boot-error-h1">{props.title ?? t("boot.failed.title", { appName: props.appName })}</h1>
        <p class="boot-error-lede">{props.description ?? t("boot.failed.lede")}</p>

        <div class="boot-error-message" role="alert">
          {message()}
        </div>

        <div class="boot-error-actions">
          <button type="button" class="btn btn-primary" onClick={() => props.onRetry()}>
            {t("boot.error.retry")}
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen()}
          >
            {detailsOpen() ? t("boot.error.detailsHide") : t("boot.error.detailsShow")}
          </button>
        </div>

        <Show when={detailsOpen()}>
          <pre class="boot-error-details">{props.error.stack ?? message()}</pre>
        </Show>

        <p class="boot-error-help">{t("boot.error.help")}</p>
      </div>
    </div>
  );
}
