import { For, Show, createMemo, onMount } from "solid-js";
import { language, formatDate, formatNumber } from "@agentz/kit/i18n";
import { t, tPlural } from "../../i18n";
import "./Heatmap.css";

export interface HeatmapProps {
  /** 365 values, oldest first, today last. Missing days = 0. */
  dailyWords: number[];
}

/** GitHub-style activity heatmap, ink ramp on the dialog surface. 53
 *  columns of 7 days each, oldest column on the left, "today" at the
 *  bottom right. Tooltip per cell shows the date + word count. */
export function Heatmap(props: HeatmapProps) {
  const grid = createMemo(() => buildGrid(props.dailyWords));
  // Read language() so language switches re-render weekday / month labels
  // immediately (memo tracks the signal).
  const monthLabels = createMemo(() => {
    void language();
    return buildMonthLabels(grid());
  });
  // Weekday labels: only every other column is visible (Mon/Wed/Fri/Sun).
  const dayLabelsVisible = createMemo(() => {
    void language();
    return [
      t("weekday.short.1"), // Mo
      "",
      t("weekday.short.3"), // Mi
      "",
      t("weekday.short.5"), // Fr
      "",
      t("weekday.short.0"), // So
    ];
  });
  // When the year doesn't fit (narrow dialog), the scroller starts at the
  // newest weeks - that's where today and recent activity are.
  let hmRef: HTMLDivElement | undefined;
  onMount(() => {
    requestAnimationFrame(() => {
      if (hmRef) hmRef.scrollLeft = hmRef.scrollWidth;
    });
  });
  return (
    <div
      ref={hmRef}
      class="hm"
      role="grid"
      aria-label={t("activity.heatmap.aria")}
    >
      <div
        class="hm-months"
        style={`grid-template-columns: 16px repeat(${grid().length}, var(--hm-cell));`}
      >
        <span />
        <For each={monthLabels()}>{(m) => <span>{m}</span>}</For>
      </div>
      <div class="hm-grid-wrap">
        <div class="hm-days">
          <For each={dayLabelsVisible()}>
            {(label) => <span aria-hidden="true">{label}</span>}
          </For>
        </div>
        <div
          class="hm-grid"
          style={`grid-template-columns: repeat(${grid().length}, var(--hm-cell));`}
        >
          <For each={grid()}>
            {(week) => (
              <div class="hm-col" role="row">
                <For each={week}>
                  {(cell) => (
                    <Show
                      when={cell !== null}
                      fallback={<span class="hm-cell hm-cell-pad" aria-hidden="true" />}
                    >
                      <span
                        class="hm-cell"
                        classList={{ "is-today": cell!.isToday }}
                        data-l={bucket(cell!.words)}
                        title={tooltip(cell!.date, cell!.words)}
                        role="gridcell"
                        aria-label={tooltip(cell!.date, cell!.words)}
                      />
                    </Show>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
      <div class="hm-legend" aria-hidden="true">
        <span>{t("activity.heatmap.less")}</span>
        <span class="hm-cell" data-l={0} />
        <span class="hm-cell" data-l={1} />
        <span class="hm-cell" data-l={2} />
        <span class="hm-cell" data-l={3} />
        <span class="hm-cell" data-l={4} />
        <span>{t("activity.heatmap.more")}</span>
      </div>
    </div>
  );
}

interface Cell {
  date: Date;
  words: number;
  isToday: boolean;
}

function bucket(w: number): 0 | 1 | 2 | 3 | 4 {
  if (!w) return 0;
  if (w < 150) return 1;
  if (w < 320) return 2;
  if (w < 520) return 3;
  return 4;
}

/** Builds a 53×7 grid: the first column contains the oldest Sunday/
 *  Monday-starting week block; the last column ends on "today". Missing
 *  leading and trailing padding slots are filled with `null`. */
function buildGrid(daily: number[]): (Cell | null)[][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = daily.length;

  // Mon = 0, Tue = 1, ... Sun = 6 (German convention).
  const todayDow = (today.getDay() + 6) % 7;

  const padStart = (7 - ((days + (6 - todayDow)) % 7)) % 7;
  const padEnd = 6 - todayDow;

  const cells: (Cell | null)[] = [];
  for (let i = 0; i < padStart; i++) cells.push(null);
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    cells.push({
      date: d,
      words: daily[i] ?? 0,
      isToday: i === days - 1,
    });
  }
  for (let i = 0; i < padEnd; i++) cells.push(null);

  const weeks: (Cell | null)[][] = [];
  for (let c = 0; c < cells.length; c += 7) {
    weeks.push(cells.slice(c, c + 7));
  }
  return weeks;
}

function buildMonthLabels(weeks: (Cell | null)[][]): string[] {
  // One label per week column - but only once per month. If the
  // week contains the 1st of a month (even mid-week, i.e.
  // when a month starts e.g. on a Thursday), we take
  // that month - otherwise the label drifts one column to the
  // right and the real start of the month would be unlabeled.
  let lastMonth = -1;
  return weeks.map((week) => {
    const firstReal = week.find((c): c is Cell => c !== null);
    if (!firstReal) return "";
    const monthMarker =
      week.find((c): c is Cell => c !== null && c.date.getDate() === 1) ??
      firstReal;
    const month = monthMarker.date.getMonth();
    if (month === lastMonth) return "";
    lastMonth = month;
    return t(`month.short.${month}` as
      | "month.short.0" | "month.short.1" | "month.short.2" | "month.short.3"
      | "month.short.4" | "month.short.5" | "month.short.6" | "month.short.7"
      | "month.short.8" | "month.short.9" | "month.short.10" | "month.short.11");
  });
}

function tooltip(date: Date, words: number): string {
  const fmt = formatDate(date, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (words === 0) return t("activity.heatmap.tooltip.noActivity", { date: fmt });
  return tPlural("activity.heatmap.tooltip.words", words, {
    date: fmt,
    count: formatNumber(words),
  });
}
