import { createSignal, onCleanup, onMount } from "solid-js";
import { sameData } from "../lib/reconcile";

interface PillBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Parts of the row hidden by its scroll container. */
  clipTop: number;
  clipBottom: number;
}

/** Nearest ancestor below `root` that clips its content. */
function clipRect(el: HTMLElement, root: HTMLElement): DOMRect | null {
  for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") return node.getBoundingClientRect();
  }
  return null;
}

/**
 * The selection highlight of the sidebar as one element that glides from
 * row to row instead of jumping. It follows whichever `.nav.is-on` the
 * module renders, also across scroll containers, and hides when no row is
 * active. While it is mounted the sidebar carries `data-nav-pill`, so the
 * rows themselves drop their own active background.
 */
export function NavIndicator(props: { root: () => HTMLElement | undefined }) {
  // Scroll and class mutations re-measure often; an unchanged box must not
  // rewrite the pill's style.
  const [box, setBox] = createSignal<PillBox | null>(null, { equals: sameData });
  const [instant, setInstant] = createSignal(true);
  let pill: HTMLSpanElement | undefined;

  onMount(() => {
    const root = props.root();
    if (!root || typeof MutationObserver === "undefined") return;
    root.setAttribute("data-nav-pill", "");
    let frame = 0;
    let jump = true;

    const measure = () => {
      frame = 0;
      const on = root.querySelector<HTMLElement>(".nav.is-on");
      const rect = on?.getBoundingClientRect();
      if (!on || !rect || rect.height === 0) {
        setBox(null);
        jump = true;
        return;
      }
      const base = root.getBoundingClientRect();
      const clip = clipRect(on, root);
      const clipTop = clip ? Math.max(0, clip.top - rect.top) : 0;
      const clipBottom = clip ? Math.max(0, rect.bottom - clip.bottom) : 0;
      if (clipTop + clipBottom >= rect.height) {
        setBox(null);
        jump = true;
        return;
      }
      setInstant(jump || box() === null);
      jump = false;
      setBox({
        x: rect.left - base.left,
        y: rect.top - base.top,
        width: rect.width,
        height: rect.height,
        clipTop,
        clipBottom,
      });
    };
    const schedule = (immediate: boolean) => {
      if (immediate) jump = true;
      if (!frame) frame = requestAnimationFrame(measure);
    };

    const mutations = new MutationObserver((records) => {
      if (records.some((r) => r.target !== pill)) schedule(false);
    });
    mutations.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    const onScroll = () => schedule(true);
    root.addEventListener("scroll", onScroll, true);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule(true));
    resize?.observe(root);
    schedule(true);

    onCleanup(() => {
      mutations.disconnect();
      resize?.disconnect();
      root.removeEventListener("scroll", onScroll, true);
      if (frame) cancelAnimationFrame(frame);
      root.removeAttribute("data-nav-pill");
    });
  });

  return (
    <span
      ref={pill}
      class="nav-pill"
      classList={{ "is-hidden": !box(), "is-instant": instant() }}
      aria-hidden="true"
      style={(() => {
        const b = box();
        if (!b) return undefined;
        return {
          width: `${b.width}px`,
          height: `${b.height}px`,
          transform: `translate3d(${b.x}px, ${b.y}px, 0)`,
          "clip-path": b.clipTop || b.clipBottom ? `inset(${b.clipTop}px 0 ${b.clipBottom}px 0 round 8px)` : undefined,
        };
      })()}
    />
  );
}
