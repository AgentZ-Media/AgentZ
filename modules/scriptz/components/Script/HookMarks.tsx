import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import type { LexicalEditor } from "lexical";
import { Icon } from "@agentz/kit/ui";
import type { TimelineSegment, TimingBlock } from "../../lib/timing";
import { t } from "../../i18n";
import { hookMarks, type HookZone } from "./timelineMath";

export interface HookMarksProps {
  editor: Accessor<LexicalEditor | null>;
  blocks: Accessor<TimingBlock[]>;
  segments: Accessor<TimelineSegment[]>;
  /** Bumps on every editor update (lines may have moved). */
  tick: Accessor<number>;
  sheet: Accessor<HTMLElement | undefined>;
  /** "Einstieg prüfen" from the chip over the opening; null hides it. */
  onCheck?: (() => void) | null;
}

interface Bar {
  zone: HookZone;
  top: number;
  height: number;
}

interface Tick {
  sec: number;
  top: number;
}

interface Layout {
  x: number;
  bars: Bar[];
  ticks: Tick[];
  /** Opening region (for the chip): top/bottom relative to the sheet. */
  top: number;
  bottom: number;
  chipRight: number;
}

/**
 * Quiet hook marks on the paper: yellow bars in the left margin next to the
 * lines that play in the first 3 / 5 / 10 seconds after the first line of
 * dialog (strong, lighter, faint), with small "3 s" / "5 s" / "10 s" ticks
 * where each mark falls. Hovering the opening shows the "Einstieg prüfen"
 * chip. Reads the rendered editor, never its state.
 */
export function HookMarks(props: HookMarksProps) {
  const [layout, setLayout] = createSignal<Layout | null>(null);
  const [hover, setHover] = createSignal(false);
  const marks = createMemo(() => hookMarks(props.blocks(), props.segments()));
  let raf = 0;

  const measure = () => {
    raf = 0;
    const ed = props.editor();
    const sheet = props.sheet();
    const root = ed?.getRootElement();
    const data = marks();
    if (!ed || !sheet || !root || data.zones.size === 0) {
      setLayout(null);
      return;
    }
    const base = sheet.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const bars: Bar[] = [];
    let top = Infinity;
    let bottom = -Infinity;
    for (const block of props.blocks()) {
      const zone = block.key ? data.zones.get(block.key) : undefined;
      if (zone === undefined || !block.key) continue;
      const el = ed.getElementByKey(block.key);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const y = r.top - base.top;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + r.height);
      const last = bars[bars.length - 1];
      // One continuous bar per zone; the gap between blocks belongs to it.
      if (last && last.zone === zone) last.height = y + r.height - last.top;
      else bars.push({ zone, top: y, height: r.height });
    }
    const ticks: Tick[] = [];
    for (const tick of data.ticks) {
      const el = ed.getElementByKey(tick.key);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      ticks.push({ sec: tick.sec, top: r.top - base.top + r.height * tick.frac });
    }
    if (bars.length === 0) {
      setLayout(null);
      return;
    }
    setLayout({ x: rootRect.left - base.left - 10, bars, ticks, top, bottom, chipRight: base.right - rootRect.right });
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(measure);
  };

  createEffect(() => {
    props.tick();
    marks();
    props.editor();
    schedule();
  });
  createEffect(() => {
    const sheet = props.sheet();
    if (!sheet) return;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
    ro?.observe(sheet);
    // The chip shows while the pointer is over the opening.
    const onMove = (event: MouseEvent) => {
      const box = layout();
      if (!box || !props.onCheck) {
        setHover(false);
        return;
      }
      const y = event.clientY - sheet.getBoundingClientRect().top;
      setHover(y >= box.top - 34 && y <= box.bottom + 4);
    };
    const onLeave = () => setHover(false);
    sheet.addEventListener("mousemove", onMove);
    sheet.addEventListener("mouseleave", onLeave);
    onCleanup(() => {
      ro?.disconnect();
      sheet.removeEventListener("mousemove", onMove);
      sheet.removeEventListener("mouseleave", onLeave);
    });
  });
  onCleanup(() => {
    if (raf) cancelAnimationFrame(raf);
  });

  return (
    <Show when={layout()}>
      {(box) => (
        <>
          <For each={box().bars}>
            {(bar) => (
              <span
                class={`hk-bar z${bar.zone}`}
                aria-hidden="true"
                style={{ left: `${box().x}px`, top: `${bar.top}px`, height: `${bar.height}px` }}
              />
            )}
          </For>
          <For each={box().ticks}>
            {(tick) => (
              <span
                class="hk-tick"
                title={t("script.hook.title", { n: tick.sec })}
                style={{ right: `calc(100% - ${box().x - 4}px)`, top: `${tick.top}px` }}
              >
                {t("script.hook.tick", { n: tick.sec })}
              </span>
            )}
          </For>
          <Show when={props.onCheck}>
            <button
              type="button"
              class="hk-chip"
              classList={{ "is-on": hover() }}
              style={{ right: `${box().chipRight}px`, top: `${Math.max(4, box().top - 30)}px` }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => props.onCheck?.()}
              tabIndex={hover() ? 0 : -1}
            >
              <Icon name="timer" size={12} />
              {t("agent.job.hook")}
            </button>
          </Show>
        </>
      )}
    </Show>
  );
}

export default HookMarks;
