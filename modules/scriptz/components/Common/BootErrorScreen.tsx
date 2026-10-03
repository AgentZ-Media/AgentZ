// Blocking recovery screen shown when the app's boot sequence
// (settings load, welcome seed, tabs load) throws an unrecoverable
// error — most commonly: the SQLite database file can't be opened
// (permissions, corruption, schema mismatch from a downgraded build).
//
// Without this screen, the previous code would fall through to the
// normal UI and surface a stack of "not found"/SQL errors. The user
// would conclude "all my scripts are gone" when the truth is "the
// database wasn't opened". This screen tells the truth, shows the
// raw error so they can copy it into a bug report, and offers a
// retry-by-reload that re-runs the boot promise from scratch.

import { createSignal, Show } from "solid-js";
import { t } from "../../i18n";

export interface BootErrorScreenProps {
  error: Error;
  onRetry(): void;
}

export function BootErrorScreen(props: BootErrorScreenProps) {
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const message = () => props.error.message || String(props.error);
  return (
    <div class="boot-error-screen">
      <div class="boot-error-inner">
        <div class="boot-error-icon" aria-hidden="true">⚠</div>
        <h1 class="boot-error-h1">{t("boot.error.title")}</h1>
        <p class="boot-error-lede">{t("boot.error.lede")}</p>

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
