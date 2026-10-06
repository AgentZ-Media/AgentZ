import { Show, createMemo } from "solid-js";
import { dailyStatsStore } from "../../stores/dailyStats";
import { settingsStore } from "../../stores/settings";
import { uiStore } from "../../stores/ui";
import { pickWritingWindow } from "../../lib/writingCounter";
import { K } from "@agentz/kit/platform";
import { getCurrentLocale } from "@agentz/kit/i18n";
import { t, tPlural } from "../../i18n";
import "./WritingCounter.css";

/** Adaptive writing counter for the sidebar footer: words in the smallest
 *  window that has any (this week -> month -> year -> last 12 months), a
 *  nudge for brand-new users, nothing at all when switched off in the
 *  settings. No goal, no streak. Click opens the activity dialog (a module
 *  overlay, also reachable from the command palette). */
export function WritingCounter() {
  const pick = createMemo(() => pickWritingWindow(dailyStatsStore.stats()));
  const fmt = (n: number) => n.toLocaleString(getCurrentLocale());

  const windowText = () => {
    switch (pick().window) {
      case "week":
        return t("counter.week");
      case "month":
        return t("counter.month");
      case "year":
        return t("counter.year");
      default:
        return t("counter.total");
    }
  };
  const tooltip = () =>
    t("counter.tooltip", {
      week: fmt(pick().all.week),
      month: fmt(pick().all.month),
      year: fmt(pick().all.year),
      total: fmt(pick().all.total),
    });
  const newHint = () => t("counter.newHint", { key: "\u0000" }).split("\u0000");

  return (
    <>
      <Show when={settingsStore.showWritingStats()}>
        <button
          type="button"
          class="wcount"
          title={pick().window === "none" ? t("counter.newTooltip") : tooltip()}
          aria-label={pick().window === "none" ? t("counter.newTooltip") : tooltip()}
          onClick={() => uiStore.openActivity()}
        >
          <Show
            when={pick().window !== "none"}
            fallback={
              <>
                <b>{t("counter.newTitle")}</b>
                <span>
                  {newHint()[0]}
                  <kbd>{K("Mod+N")}</kbd>
                  {newHint()[1] ?? ""}
                </span>
              </>
            }
          >
            <b class="num">{tPlural("counter.words", pick().words, { count: fmt(pick().words) })}</b>
            <span>{windowText()}</span>
          </Show>
        </button>
      </Show>
    </>
  );
}
