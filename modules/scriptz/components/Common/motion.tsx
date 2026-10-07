// Small motion helpers shared by the script screen, the lists and the agent.
// Every helper does nothing (or jumps straight to the end state) when the
// user asked for reduced motion; tokens.css additionally cuts all CSS
// animations short in that case.

import { For, Show, createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js";
import "./motion.css";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Follows `source`, easing from the old to the new value over `ms`.
 *  Whole numbers in, whole numbers out (rounded on the way). */
export function createTween(source: Accessor<number>, ms = 420): Accessor<number> {
  const [value, setValue] = createSignal(source());
  let raf = 0;
  createEffect(
    on(
      source,
      (to) => {
        cancelAnimationFrame(raf);
        const from = value();
        if (from === to || prefersReducedMotion() || typeof requestAnimationFrame === "undefined") {
          setValue(to);
          return;
        }
        const start = performance.now();
        const step = (now: number) => {
          const k = Math.min(1, (now - start) / ms);
          const eased = 1 - Math.pow(1 - k, 3);
          setValue(Math.round(from + (to - from) * eased));
          if (k < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      { defer: true },
    ),
  );
  onCleanup(() => cancelAnimationFrame(raf));
  return value;
}

/** Restarts a CSS animation class on an element (e.g. a count that
 *  changed). */
export function replayClass(el: Element | null | undefined, cls: string): void {
  if (!el || prefersReducedMotion()) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

interface RollDigit {
  now: string;
  /** The digit this place showed before the change; null when unchanged. */
  old: string | null;
}

/** Digits of `now`, right-aligned against `before`, marking the places
 *  that changed so only those roll. */
export function rollDigits(now: string, before: string | null): RollDigit[] {
  const len = Math.max(now.length, before?.length ?? 0);
  const a = now.padStart(len, " ");
  const b = before === null ? null : before.padStart(len, " ");
  return Array.from(a, (digit, i) => ({ now: digit, old: b !== null && b[i] !== digit ? b[i] : null }));
}

/** A number that rolls like a counter when it changes (only the digits
 *  that changed, upwards when it grows, downwards when it shrinks) and
 *  pops a little. Nothing moves on first render or with reduced motion. */
export function BumpNumber(props: { value: number; class?: string; title?: string }) {
  let el: HTMLSpanElement | undefined;
  const [before, setBefore] = createSignal<string | null>(null);
  const [down, setDown] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      () => props.value,
      (value, previous) => {
        clearTimeout(timer);
        if (previous === undefined || prefersReducedMotion()) {
          setBefore(null);
          return;
        }
        setDown(value < previous);
        setBefore(String(previous));
        replayClass(el, "is-bump");
        timer = setTimeout(() => setBefore(null), 560);
      },
      { defer: true },
    ),
  );
  onCleanup(() => clearTimeout(timer));
  return (
    <span
      ref={el}
      class={props.class ? `mo-bump ${props.class}` : "mo-bump"}
      classList={{ "is-down": down() }}
      title={props.title}
    >
      {/* Inline digits keep the plain number as text; only the digit that
          rolls away is hidden from assistive tech. */}
      <For each={rollDigits(String(props.value), before())}>
        {(d) => (
          <span class="mo-digit" classList={{ "is-rolling": d.old !== null }}>
            <Show when={d.old !== null}><span class="mo-digit-old" aria-hidden="true">{d.old}</span></Show>
            <span class="mo-digit-now">{d.now === " " ? "" : d.now}</span>
          </span>
        )}
      </For>
    </span>
  );
}

/** Lets a small card with `text` fly from `from` into `target` and pops
 *  the target afterwards (an idea landing in the sidebar). */
export function flyInto(from: DOMRect, target: Element | null, text: string): void {
  if (!target || prefersReducedMotion() || typeof document === "undefined") return;
  const to = target.getBoundingClientRect();
  if (to.width === 0 || to.height === 0) return;
  const card = document.createElement("div");
  card.className = "mo-fly";
  card.textContent = text;
  card.style.left = `${from.left}px`;
  card.style.top = `${from.top}px`;
  card.style.width = `${from.width}px`;
  document.body.appendChild(card);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + card.offsetHeight / 2);
  const run = card.animate(
    [
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: "translate(0, -6px) scale(1.02)", opacity: 1, offset: 0.25 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.08)`, opacity: 0.15 },
    ],
    { duration: 640, easing: "cubic-bezier(.55,0,.25,1)" },
  );
  const done = () => {
    card.remove();
    replayClass(target, "is-landed");
  };
  run.onfinish = done;
  run.oncancel = () => card.remove();
}
