// Small motion helpers shared by the script screen, the lists and the agent.
// Every helper does nothing (or jumps straight to the end state) when the
// user asked for reduced motion; tokens.css additionally cuts all CSS
// animations short in that case.

import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js";
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

/** A number that pops briefly whenever it changes (not on first render). */
export function BumpNumber(props: { value: number; class?: string; title?: string }) {
  let el: HTMLSpanElement | undefined;
  createEffect(on(() => props.value, () => replayClass(el, "is-bump"), { defer: true }));
  return (
    <span ref={el} class={props.class ? `mo-bump ${props.class}` : "mo-bump"} title={props.title}>
      {props.value}
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

/** Briefly highlights elements, e.g. lines a proposal just inserted. */
export function flash(elements: ReadonlyArray<Element | null | undefined>, cls = "mo-flash", ms = 2600): void {
  if (prefersReducedMotion()) return;
  const live = elements.filter((el): el is Element => !!el);
  for (const el of live) replayClass(el, cls);
  setTimeout(() => {
    for (const el of live) el.classList.remove(cls);
  }, ms);
}

// The row or card the writer just clicked: the element the opening script
// grows out of. Only valid for a moment after the click.
let openSource: { el: Element; at: number } | null = null;

export function rememberOpenSource(el: Element | null | undefined): void {
  openSource = el ? { el, at: Date.now() } : null;
}

function recentOpenSource(): Element | null {
  if (!openSource || Date.now() - openSource.at > 1500 || !openSource.el.isConnected) return null;
  return openSource.el;
}

/** The full script view's paper (never the side panel's). */
export function fullPaper(): Element | null {
  return typeof document === "undefined" ? null : document.querySelector(".ss:not(.is-peek) .ss-sheet");
}

/** Opens a script in the full view, growing it out of the clicked row. */
export function openScriptAnimated(open: () => void | Promise<void>): void {
  openWithTransition(recentOpenSource(), open, fullPaper);
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> };
};

/** Morphs `source` into the paper of the script that opens (View
 *  Transitions where the web view supports them, otherwise a plain
 *  switch). `ready` must find the new paper once it is on screen. */
export function openWithTransition(
  source: Element | null,
  update: () => void | Promise<void>,
  ready: () => Element | null,
): void {
  const doc = document as ViewTransitionDocument;
  const el = source as HTMLElement | null;
  // A full script view on screen already has the name: two would abort.
  if (!el || !doc.startViewTransition || prefersReducedMotion() || ready()) {
    void update();
    return;
  }
  el.style.setProperty("view-transition-name", "scriptz-open");
  let paper: HTMLElement | null = null;
  const transition = doc.startViewTransition(async () => {
    el.style.removeProperty("view-transition-name");
    // The screen is frozen while this callback runs: wait for the update
    // (it may flush first) and the new paper within one short deadline. The
    // update itself keeps running past it.
    const start = performance.now();
    let settled = false;
    void Promise.resolve()
      .then(update)
      .catch((err) => console.error("[scriptz] open failed", err))
      .finally(() => (settled = true));
    while ((!settled || !ready()) && performance.now() - start < 360) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    // The name lives on the paper only for this transition.
    paper = ready() as HTMLElement | null;
    paper?.style.setProperty("view-transition-name", "scriptz-open");
  });
  void transition.finished.finally(() => paper?.style.removeProperty("view-transition-name"));
}
