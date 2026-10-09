import { t } from "../i18n";
import { Icon } from "../ui";
import { baseSettingsStore } from "../stores/baseSettings";
import { pushToast } from "../stores/toasts";
import { shellUi } from "../stores/ui";

/**
 * The small floating "Report a problem" button in the bottom right. It shows
 * only its icon and unfolds on hover or focus, together with a button to
 * hide it (Settings > Appearance brings it back). Screens move it out of
 * the way of their own controls with `shell.setReportPillPlacement()`.
 */
export function ReportPill(props: { appName: string; onOpen(): void }) {
  const hide = () => {
    void baseSettingsStore.setReportButton(false);
    pushToast(t("report.pill.hidden", { appName: props.appName }), "info", 7000, {
      action: { label: t("report.pill.undo"), run: () => baseSettingsStore.setReportButton(true) },
    });
  };
  const placement = () => shellUi.reportPillPlacement();
  const px = (value: number | undefined) => (value === undefined ? undefined : `${value}px`);
  return (
    <div class="rpt-pill" classList={{ "is-away": !!placement()?.hidden }} aria-hidden={placement()?.hidden || undefined}
      inert={placement()?.hidden || undefined}
      style={{ right: px(placement()?.right), bottom: px(placement()?.bottom) }}>
      <button type="button" class="rpt-pill-open" onClick={() => props.onOpen()}
        aria-label={t("report.pill")}>
        <Icon name="report" size={15} />
        <span class="rpt-pill-label" aria-hidden="true">{t("report.pill")}</span>
      </button>
      <button type="button" class="rpt-pill-hide" onClick={hide}
        aria-label={t("report.pill.hide")} title={t("report.pill.hide")}>
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}
