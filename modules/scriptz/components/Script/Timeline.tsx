import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js";
import { Icon } from "@agentz/kit/ui";
import { formatClock, formatRange, lengthStatus, type LengthRange } from "../../lib/lengthGoal";
import type { TimelineSegment } from "../../lib/timing";
import { createTween } from "../Common/motion";
import { K } from "@agentz/kit/platform";
import { getCurrentLocale } from "@agentz/kit/i18n";
import { t } from "../../i18n";
import {
  HOOK_MARKS,
  axisTicks,
  firstDialogStart,
  laneSpeakers,
  longestDialogKey,
  pct,
  textStart,
  timelineWindow,
} from "./timelineMath";
import "./Timeline.css";

export type RangeSource = { kind: "folder"; name: string } | { kind: "default" };

export interface TimelineProps {
  segments: TimelineSegment[];
  /** Displayed total runtime (whole seconds, lib/runtime.ts). */
  runtimeSec: number;
  range: LengthRange | null;
  rangeSource: RangeSource | null;
  /** Playhead position in seconds (start of the caret block). */
  playhead: number;
  wpm: number;
  open: boolean;
  colorOf(speaker: string): string;
  onToggle(): void;
  /** Hovering a section links it to its paper line (null = hover ended). */
  onHover(seg: TimelineSegment | null): void;
  onJump(seg: TimelineSegment): void;
  /** Agent jobs offered at the length while it is over the range (hover
   *  only). Null when the agent is not available. */
  onJob?: ((job: "cut" | "tempo") => void) | null;
}

interface Lane {
  id: string;
  label: string;
  /** Character colour for speaker lanes; null for action / unnamed. */
  color: string | null;
  kind: "speaker" | "unnamed" | "action";
  segments: TimelineSegment[];
}

interface TipState {
  seg: TimelineSegment;
  label: string;
  left: number;
  bottom: number;
  arrow: number;
}

const TIP_WIDTH = 270;

/** Timeline under the paper: a 40 px
 *  bar with the mini track by default, ⌘J expands one lane per speaker. */
export function Timeline(props: TimelineProps) {
  const [tip, setTip] = createSignal<TipState | null>(null);
  let areaRef: HTMLDivElement | undefined;

  const win = createMemo(() => timelineWindow(props.runtimeSec, props.range));
  const status = createMemo(() => lengthStatus(props.runtimeSec, props.range));
  const rangeText = () => formatRange(props.range);
  const longest = createMemo(() => longestDialogKey(props.segments));
  const shownSec = createTween(() => props.runtimeSec);
  // The hook clock starts with the first spoken line (not with a stage
  // direction before it).
  const hookStart = createMemo(() => firstDialogStart(props.segments));
  // Right after ⌘J opens the timeline its lanes grow in once. Only in this
  // window - segments re-render on every keystroke and must not replay.
  const [opening, setOpening] = createSignal(false);
  let openingTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(on(() => props.open, (open) => {
    clearTimeout(openingTimer);
    setOpening(open);
    if (open) openingTimer = setTimeout(() => setOpening(false), 1100);
  }, { defer: true }));
  onCleanup(() => clearTimeout(openingTimer));

  const lanes = createMemo<Lane[]>(() => {
    const { speakers, hasUnnamed } = laneSpeakers(props.segments);
    const out: Lane[] = speakers.map((name) => ({
      id: `s:${name}`,
      label: name,
      color: props.colorOf(name),
      kind: "speaker" as const,
      segments: props.segments.filter((s) => s.kind === "dialog" && s.speaker === name),
    }));
    if (hasUnnamed) {
      out.push({
        id: "unnamed",
        label: t("script.tl.noSpeaker"),
        color: null,
        kind: "unnamed",
        segments: props.segments.filter((s) => s.kind === "dialog" && s.speaker === null),
      });
    }
    out.push({
      id: "action",
      label: t("block.action"),
      color: null,
      kind: "action",
      segments: props.segments.filter((s) => s.kind === "action"),
    });
    return out;
  });

  const segStyle = (s: TimelineSegment, lane: Lane | null): JSX.CSSProperties => {
    const w = win();
    const style: JSX.CSSProperties = {
      left: `${pct(s.startSec, w)}%`,
      width: `${Math.max(0, pct(s.startSec + s.durSec, w) - pct(s.startSec, w))}%`,
    };
    const color = lane ? lane.color : s.kind === "dialog" && s.speaker ? props.colorOf(s.speaker) : null;
    if (color) style.background = color;
    return style;
  };

  const segClass = (s: TimelineSegment) =>
    s.kind === "action" ? "seg-act" : s.speaker === null ? "seg-anon" : "seg-char";

  // ---------- hover / tooltip ----------
  const fmtSec = (sec: number) =>
    sec.toLocaleString(getCurrentLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const onEnter = (seg: TimelineSegment, label: string, el: HTMLElement) => {
    props.onHover(seg);
    if (!areaRef) return;
    const a = areaRef.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const left = Math.max(0, Math.min(r.left - a.left - 12, a.width - TIP_WIDTH));
    const segCenter = r.left - a.left + Math.min(r.width, 40) / 2;
    setTip({
      seg,
      label,
      left,
      bottom: a.bottom - r.top + 8,
      arrow: Math.max(10, Math.min(TIP_WIDTH - 20, segCenter - left - 5)),
    });
  };
  const onLeave = () => {
    setTip(null);
    props.onHover(null);
  };
  // Collapsing (⌘J) or unmounting (focus mode) while a section is hovered
  // removes it without a mouseleave - drop the tooltip and the paper link.
  createEffect(on(() => props.open, (open) => !open && tip() && onLeave(), { defer: true }));
  onCleanup(() => {
    if (tip()) onLeave();
  });

  // Mini track: click anywhere jumps to the section under the pointer.
  const onMiniClick = (ev: MouseEvent) => {
    const el = ev.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const sec = ((ev.clientX - r.left) / r.width) * win();
    const hit = props.segments.find((s) => sec >= s.startSec && sec < s.startSec + s.durSec);
    if (hit) props.onJump(hit);
  };

  // ---------- labels ----------
  const lenLabel = (expanded: boolean) => (
    <span class="tl-len" title={t("script.tl.estimate", { wpm: props.wpm })}>
      <b classList={{ over: status().state === "over" }}>{formatClock(shownSec())}</b>
      <Show when={rangeText()}>
        {" / "}
        {t("script.tl.goal", { range: rangeText() })}
        <Show when={expanded && props.rangeSource}>
          {(src) => (
            <>
              {" "}
              {src().kind === "folder"
                ? t("script.tl.fromFolder", { folder: (src() as { kind: "folder"; name: string }).name })
                : t("script.tl.fromDefault")}
            </>
          )}
        </Show>
      </Show>
      <Show when={expanded && status().state === "over"}>
        <em>{t("script.insp.over", { n: status().deltaSec })}</em>
      </Show>
      <Show when={expanded && status().state === "under"}>
        <em class="calm">{t("script.insp.under", { n: status().deltaSec })}</em>
      </Show>
    </span>
  );

  // ---------- zones (hook, range, max, over, playhead) ----------
  const Zones = (zp: { withHeadLabel: boolean }) => {
    const w = () => win();
    const min = () => props.range?.minSec ?? null;
    const max = () => props.range?.maxSec ?? null;
    const bandStart = () => min();
    const bandEnd = () => (min() !== null ? (max() ?? w()) : null);
    return (
      <>
        <Show when={hookStart() !== null}>
          {(() => {
            const zone = (from: number, to: number) => {
              const s0 = hookStart() as number;
              return { left: `${pct(s0 + from, w())}%`, width: `${pct(s0 + to, w()) - pct(s0 + from, w())}%` };
            };
            return (
              <>
                <span class="z-hook z0" style={zone(0, HOOK_MARKS[0])} />
                <span class="z-hook z1" style={zone(HOOK_MARKS[0], HOOK_MARKS[1])} />
                <span class="z-hook z2" style={zone(HOOK_MARKS[1], HOOK_MARKS[2])} />
              </>
            );
          })()}
        </Show>
        <Show when={bandStart() !== null && bandEnd() !== null}>
          <span
            class="z-range"
            style={{
              left: `${pct(bandStart() as number, w())}%`,
              width: `${pct(bandEnd() as number, w()) - pct(bandStart() as number, w())}%`,
            }}
          />
        </Show>
        <Show when={max() !== null && props.runtimeSec > (max() as number)}>
          <span
            class="z-over"
            style={{
              left: `${pct(max() as number, w())}%`,
              width: `${pct(props.runtimeSec, w()) - pct(max() as number, w())}%`,
            }}
          />
        </Show>
        <Show when={max() !== null}>
          <span class="z-goal" style={{ left: `${pct(max() as number, w())}%` }} />
        </Show>
        <span
          class="z-head"
          classList={{ "with-label": zp.withHeadLabel }}
          data-t={formatClock(props.playhead)}
          style={{ left: `${pct(props.playhead, w())}%` }}
        />
      </>
    );
  };

  const ticks = createMemo(() => {
    const w = win();
    const near = (a: number, b: number | null) => b !== null && Math.abs(a - b) < w * 0.045;
    const min = props.range?.minSec ?? null;
    const max = props.range?.maxSec ?? null;
    return axisTicks(w).ticks.map((sec) => ({
      sec,
      // The 0:00 tick survives the range labels but yields to the playhead
      // label (which then shows the same time) - otherwise the two overlap.
      hidden: (sec !== 0 && (near(sec, min) || near(sec, max))) || near(sec, props.playhead),
    }));
  });

  return (
    <section class="tl" classList={{ "is-open": props.open, "is-opening": opening() }} aria-label={t("script.tl.aria")}>
      <div class="tl-bar">
        <button
          type="button"
          class="tl-tog"
          aria-expanded={props.open}
          title={t("script.tl.toggleTitle", { hotkey: K("Mod+J") })}
          onMouseDown={(e) => e.preventDefault()}
          onClick={props.onToggle}
        >
          <Icon name={props.open ? "down" : "up"} size={13} />
          {t("script.tl.toggle")}
          <kbd>{K("Mod+J")}</kbd>
        </button>
        <Show when={!props.open} fallback={<span />}>
          <div class="tl-mini">
            <div class="mini" onMouseDown={(e) => e.preventDefault()} onClick={onMiniClick}>
              <For each={props.segments}>{(s) => <i class={segClass(s)} style={segStyle(s, null)} />}</For>
              <Zones withHeadLabel={false} />
            </div>
          </div>
        </Show>
        <div class="tl-len-wrap">
          <Show when={props.onJob && status().state === "over"}>
            <div class="tl-jobs" role="group" aria-label={t("script.tl.jobsAria")}>
              <button type="button" class="tl-job" onMouseDown={(e) => e.preventDefault()} onClick={() => props.onJob?.("cut")}>
                <Icon name="scissors" size={12} />
                {t("agent.job.cut")}
              </button>
              <button type="button" class="tl-job" onMouseDown={(e) => e.preventDefault()} onClick={() => props.onJob?.("tempo")}>
                <Icon name="bolt" size={12} />
                {t("agent.job.tempo")}
              </button>
            </div>
          </Show>
          {lenLabel(props.open)}
        </div>
      </div>

      <Show when={props.open}>
        <div class="tl-body">
          <div class="tl-names">
            <div />
            <For each={lanes()}>
              {(lane) => (
                <div
                  classList={{ "is-action": lane.kind === "action", "is-anon": lane.kind === "unnamed" }}
                  style={lane.color ? { "--c": lane.color } : undefined}
                  title={lane.label}
                >
                  {lane.label}
                </div>
              )}
            </For>
          </div>
          <div class="tl-area" ref={areaRef}>
            <div class="axis">
              <For each={ticks()}>
                {(tk) => (
                  <span
                    classList={{ first: tk.sec === 0 }}
                    style={{ left: `${pct(tk.sec, win())}%`, opacity: tk.hidden ? 0 : undefined }}
                  >
                    {formatClock(tk.sec)}
                  </span>
                )}
              </For>
              <Show when={props.range?.minSec != null}>
                <span class="rmin" style={{ left: `${pct(props.range?.minSec as number, win())}%` }}>
                  {formatClock(props.range?.minSec as number)}
                </span>
              </Show>
              <Show when={props.range?.maxSec != null}>
                <span class="goal" style={{ left: `${pct(props.range?.maxSec as number, win())}%` }}>
                  {formatClock(props.range?.maxSec as number)}
                </span>
              </Show>
              <Show when={props.range?.minSec != null && props.range?.maxSec != null}>
                <span
                  class="rbar"
                  style={{
                    left: `${pct(props.range?.minSec as number, win())}%`,
                    width: `${pct(props.range?.maxSec as number, win()) - pct(props.range?.minSec as number, win())}%`,
                  }}
                />
              </Show>
              <span class="last">{formatClock(win())}</span>
            </div>
            <For each={lanes()}>
              {(lane) => (
                <div class="lane">
                  <For each={lane.segments}>
                    {(s, i) => (
                      <i
                        class={segClass(s)}
                        classList={{ "is-hover": tip()?.seg === s }}
                        style={{ ...segStyle(s, lane), "--i": String(i()) }}
                        onMouseEnter={(e) => onEnter(s, lane.kind === "action" ? t("block.action") : lane.label, e.currentTarget)}
                        onMouseLeave={onLeave}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => props.onJump(s)}
                      />
                    )}
                  </For>
                </div>
              )}
            </For>
            <div class="tl-zones">
              <Zones withHeadLabel={true} />
            </div>
            <Show when={tip()}>
              {(tp) => (
                <div
                  class="tl-tip"
                  role="tooltip"
                  style={{ left: `${tp().left}px`, bottom: `${tp().bottom}px`, "--tip-arrow": `${tp().arrow}px` }}
                >
                  <b>{tp().label}</b>
                  <span class="tc">
                    {formatClock(tp().seg.startSec)} - {formatClock(tp().seg.startSec + tp().seg.durSec)} ·{" "}
                    {t("script.tl.tip.dur", { sec: fmtSec(tp().seg.durSec) })}
                  </span>
                  <Show when={tp().seg.text.trim()}>
                    <p>{textStart(tp().seg.text)}</p>
                  </Show>
                  <small>
                    <Show when={tp().seg.key && tp().seg.key === longest() && tp().seg.kind === "dialog"}>
                      {t("script.tl.tip.longest")}
                      {" · "}
                    </Show>
                    {t("script.tl.tip.jump")}
                  </small>
                </div>
              )}
            </Show>
          </div>
          <div />
        </div>
        <div class="legend">
          <span>
            <i class="lg-hook" />
            {t("script.tl.legend.hook")}
          </span>
          <Show when={props.range?.minSec != null}>
            <span>
              <i class="lg-range" />
              {t("script.tl.legend.range")}
            </span>
          </Show>
          <Show when={props.range?.maxSec != null}>
            <span>
              <i class="lg-max" />
              {t("script.tl.legend.max")}
            </span>
            <span>
              <i class="lg-over" />
              {t("script.tl.legend.over")}
            </span>
          </Show>
          <span class="lg-hint">{t("script.tl.legend.click")}</span>
        </div>
      </Show>
    </section>
  );
}

export default Timeline;
