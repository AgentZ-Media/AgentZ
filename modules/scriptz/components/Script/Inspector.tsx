import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Icon } from "@agentz/kit/ui";
import { api } from "../../lib/api";
import { formatClock, formatRange, lengthStatus, type LengthRange } from "../../lib/lengthGoal";
import { createTween } from "../Common/motion";
import { scriptStages, stageIndex } from "../../lib/stages";
import type { ScriptCharacter, ScriptStatus } from "../../lib/types";
import { K } from "@agentz/kit/platform";
import { ideasStore } from "../../stores/ideas";
import { getCurrentLocale } from "@agentz/kit/i18n";
import { t, tPlural } from "../../i18n";
import { stageLabel } from "./stageActions";
import { sinceBucket, type LiveStats } from "./timelineMath";

export interface InspectorProps {
  scriptId: string;
  status: ScriptStatus;
  /** Unix-millis of the last stage change (falls back to creation). */
  statusSince: number;
  stats: LiveStats;
  range: LengthRange | null;
  characters: ScriptCharacter[];
  /** Bumps whenever the version list may have changed. */
  versionsKey: number;
  onOpenColorPicker(name: string, anchor: { x: number; y: number }): void;
  onOpenVersions(): void;
}

const NEUTRAL_DOT = "var(--faint)";

/** Right-hand inspector. Information only - no
 *  settings live here. */
export function Inspector(props: InspectorProps) {
  // Ticks once a minute so "seit 5 Minuten" stays honest.
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(timer));

  const stageIdx = () => stageIndex(props.status);

  const since = () => {
    const b = sinceBucket(props.statusSince, now());
    if (b.unit === "now") return t("script.insp.since.now");
    return tPlural(`script.insp.since.${b.unit}`, b.count);
  };

  const len = () => lengthStatus(props.stats.runtimeSec, props.range);
  // The number counts to its new value instead of jumping.
  const shownSec = createTween(() => props.stats.runtimeSec);
  const rangeText = () => formatRange(props.range);

  const colorOf = (name: string): string =>
    props.characters.find((c) => c.name.toUpperCase() === name)?.color ?? NEUTRAL_DOT;

  // `.latest` and a plain signal instead of resources: the shell renders
  // this screen inside <Suspense>, and a resource read for the first time
  // later (inspector toggled open, ideas refetching) would suspend the
  // whole screen and detach the editor.
  const idea = createMemo(
    () => (ideasStore.ideas.latest ?? []).find((i) => i.script_id === props.scriptId) ?? null,
  );

  const [versions, setVersions] = createSignal<{ count: number; last: number } | null>(null);
  createEffect(() => {
    const id = props.scriptId;
    void props.versionsKey;
    let cancelled = false;
    api
      .listSnapshots(id)
      .then((list) => {
        let last = 0;
        for (const s of list) last = Math.max(last, s.created_at);
        if (!cancelled) setVersions({ count: list.length, last });
      })
      .catch(() => {
        if (!cancelled) setVersions({ count: 0, last: 0 });
      });
    onCleanup(() => {
      cancelled = true;
    });
  });

  const lastLabel = () => {
    const v = versions();
    if (!v || v.last === 0) return t("script.insp.versionsNone");
    const d = new Date(v.last);
    const today = new Date(now());
    const sameDay = d.toDateString() === today.toDateString();
    const time = sameDay
      ? d.toLocaleTimeString(getCurrentLocale(), { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString(getCurrentLocale(), { day: "numeric", month: "short" });
    return t("script.insp.versionsLast", { time });
  };

  const emptyParts = () => t("script.insp.castEmpty").split("{block}");
  const fmtNum = (n: number) => n.toLocaleString(getCurrentLocale());
  // "52 %" in German, "52%" in English.
  const fmtPct = (n: number) =>
    (n / 100).toLocaleString(getCurrentLocale(), { style: "percent", maximumFractionDigits: 0 });

  return (
    <aside class="ss-insp" aria-label={t("script.insp.aria")}>
      <section class="ss-sec">
        <div class="ss-sec-h">{t("script.insp.stage")}</div>
        <div class="ss-steps" aria-hidden="true">
          <For each={scriptStages()}>{(_, i) => <span classList={{ done: i() <= stageIdx() }} />}</For>
        </div>
        <div class="ss-step-now">
          <b>{stageLabel(props.status)}</b>
          <span>{since()}</span>
        </div>
      </section>

      <section class="ss-sec">
        <div class="ss-sec-h">{t("script.insp.length")}</div>
        <div class="ss-len">
          <b classList={{ over: len().state === "over" }}>{formatClock(shownSec())}</b>
          <Show when={rangeText()}>
            <span>/ {rangeText()}</span>
          </Show>
          <Show when={len().state === "over"}>
            <span class="ss-pill">{t("script.insp.over", { n: len().deltaSec })}</span>
          </Show>
          <Show when={len().state === "under"}>
            <span class="ss-pill calm">{t("script.insp.under", { n: len().deltaSec })}</span>
          </Show>
        </div>
        <div class="ss-facts">
          <span>
            <b>{fmtNum(props.stats.words)}</b> {tPlural("units.word", props.stats.words)}
          </span>
          <span>
            <b>{fmtNum(props.stats.dialogWords)}</b> {t("script.insp.dialogWords")}
          </span>
          <span>
            <b>{fmtNum(props.stats.speakerChanges)}</b> {tPlural("script.insp.switches", props.stats.speakerChanges)}
          </span>
        </div>
      </section>

      <section class="ss-sec">
        <div class="ss-sec-h">
          {t("script.insp.cast")}
          <Show when={props.stats.cast.length > 0}>
            <span class="r">{t("script.insp.castShare")}</span>
          </Show>
        </div>
        <Show
          when={props.stats.cast.length > 0}
          fallback={
            <p class="ss-muted">
              {emptyParts()[0]}
              <b>{t("block.character")}</b>
              {emptyParts()[1] ?? ""}
            </p>
          }
        >
          <For each={props.stats.cast}>
            {(c) => (
              <>
                <div class="ss-crow" style={{ "--c": colorOf(c.name) }}>
                  <button
                    type="button"
                    class="ss-sw scriptz-color-picker-trigger"
                    title={t("charDropdown.colorAria", { name: c.name })}
                    aria-label={t("charDropdown.colorAria", { name: c.name })}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      props.onOpenColorPicker(c.name, { x: r.left - 232, y: r.top - 8 });
                    }}
                  />
                  <span class="ss-nm">{c.name}</span>
                  <span class="ss-pc">{fmtPct(c.pct)}</span>
                </div>
                <div class="ss-crow-bar" style={{ "--c": colorOf(c.name) }}>
                  <i style={{ width: `${c.pct}%` }} />
                </div>
              </>
            )}
          </For>
        </Show>
      </section>

      <Show when={idea()}>
        {(i) => (
          <section class="ss-sec">
            <div class="ss-sec-h">{t("script.insp.idea")}</div>
            <div class="ss-origin">
              <b>{i().title}</b>
              <Show when={i().notes.trim()}>
                <p>{i().notes}</p>
              </Show>
            </div>
          </section>
        )}
      </Show>

      <section class="ss-sec">
        <button
          type="button"
          class="ss-ver-row"
          title={t("script.insp.versionsTitle", { hotkey: K("Mod+Shift+H") })}
          onClick={props.onOpenVersions}
        >
          <span class="ss-ver-l">
            <Icon name="history" size={14} />
            <b>{t("script.insp.versions")}</b>
            <span>{versions()?.count ?? ""}</span>
          </span>
          <span class="ss-ver-r">
            {lastLabel()}
            <Icon name="right" size={12} />
          </span>
        </button>
      </section>
    </aside>
  );
}

export default Inspector;
