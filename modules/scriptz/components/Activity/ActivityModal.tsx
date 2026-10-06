import { For, createMemo } from "solid-js";
import { dailyStatsStore } from "../../stores/dailyStats";
import { uiStore } from "../../stores/ui";
import { pickWritingWindow } from "../../lib/writingCounter";
import { formatNumber } from "@agentz/kit/i18n";
import { t } from "../../i18n";
import { DialogFrame } from "@agentz/kit/ui";
import { Heatmap } from "./Heatmap";
import "./ActivityModal.css";

/** Writing activity (opened from the sidebar writing counter, or anywhere
 *  via `uiStore.openActivity()`): word totals per window plus the 365-day
 *  heatmap. Deliberately no streak and no goal. */
export function ActivityModal() {
  const stats = () => dailyStatsStore.stats();
  const pick = createMemo(() => pickWritingWindow(stats()));
  const fmt = (n: number) => formatNumber(n);
  const cards = () => [
    { label: t("activityDialog.week"), value: pick().all.week },
    { label: t("activityDialog.month"), value: pick().all.month },
    { label: t("activityDialog.year"), value: pick().all.year },
    { label: t("activityDialog.total"), value: pick().all.total },
  ];

  return (
    <DialogFrame
      open={uiStore.activityOpen()}
      onClose={() => uiStore.closeActivity()}
      label={t("activityDialog.title")}
      class="act"
    >
      <div class="act-in">
        <div class="dlg-h">
          <div>
            <b>{t("activityDialog.title")}</b>
            <small>{t("activityDialog.sub")}</small>
          </div>
          <button
            type="button"
            class="dlg-esc"
            onClick={() => uiStore.closeActivity()}
            aria-label={t("common.close")}
            data-autofocus
          >
            <kbd>esc</kbd>
          </button>
        </div>
        <div class="act-cards">
          <For each={cards()}>
            {(c) => (
              <div class="act-card">
                <span class="act-card-l">{c.label}</span>
                <b class="num">{fmt(c.value)}</b>
                <span class="act-card-u">{t("units.words")}</span>
              </div>
            )}
          </For>
        </div>
        <div class="act-hm">
          <div class="act-hm-head">
            <b>{t("activity.heatmap.title")}</b>
            <span>
              {stats().activeDays > 0
                ? t("activity.heatmap.activeDays", { count: fmt(stats().activeDays) })
                : t("activity.activeDaysNone")}
            </span>
          </div>
          <Heatmap dailyWords={stats().dailyWords} />
        </div>
      </div>
    </DialogFrame>
  );
}
