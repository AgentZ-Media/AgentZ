import { Show, createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import type { LexicalEditor } from "lexical";
import { BLOCK_HOTKEYS, blockLabel } from "../Editor/nodes";
import { K } from "../../lib/keys";
import type { CaretBlock } from "./liveEditor";

export interface GutterLabelProps {
  editor: Accessor<LexicalEditor | null>;
  caret: Accessor<CaretBlock | null>;
  focused: Accessor<boolean>;
  /** Bumps on every editor update (the caret block may have moved). */
  tick: Accessor<number>;
  /** The paper sheet the label is positioned in. */
  sheet: Accessor<HTMLElement | undefined>;
}

const GAP_PX = 12;

/**
 * Yellow block-type label in the canvas margin, left of the paper and level
 * with the caret block ("Charakter ⌘2"). Only one at a time, only while the
 * editor has focus, hidden when the margin is too narrow to hold it.
 */
export function GutterLabel(props: GutterLabelProps) {
  const [top, setTop] = createSignal<number | null>(null);
  let labelRef: HTMLSpanElement | undefined;
  let raf = 0;

  const measure = () => {
    raf = 0;
    const ed = props.editor();
    const caret = props.caret();
    const sheet = props.sheet();
    if (!ed || !caret || !sheet || !props.focused()) {
      setTop(null);
      return;
    }
    const el = ed.getElementByKey(caret.key);
    if (!el) {
      setTop(null);
      return;
    }
    const sheetRect = sheet.getBoundingClientRect();
    const canvas = sheet.parentElement;
    const room = canvas ? sheetRect.left - canvas.getBoundingClientRect().left : 0;
    const need = (labelRef?.offsetWidth ?? 110) + GAP_PX + 8;
    if (room < need) {
      setTop(null);
      return;
    }
    const r = el.getBoundingClientRect();
    // Centre the 20 px label on the block's first line.
    const lineH = parseFloat(getComputedStyle(el).lineHeight) || 22;
    setTop(r.top - sheetRect.top + Math.max(0, (lineH - 20) / 2));
  };

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(measure);
  };

  createEffect(() => {
    props.caret();
    props.focused();
    props.tick();
    props.editor();
    schedule();
  });

  // Canvas width changes (window resize, inspector / sidebar toggles) and
  // paper reflows move the block without an editor update.
  createEffect(() => {
    const sheet = props.sheet();
    if (!sheet || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => schedule());
    ro.observe(sheet);
    if (sheet.parentElement) ro.observe(sheet.parentElement);
    onCleanup(() => ro.disconnect());
  });
  onCleanup(() => {
    if (raf) cancelAnimationFrame(raf);
  });

  return (
    <Show when={props.caret()}>
      {(c) => (
        <span
          ref={labelRef}
          class="ss-gut"
          aria-hidden="true"
          style={{
            top: `${top() ?? 0}px`,
            visibility: top() === null ? "hidden" : "visible",
            right: `calc(100% + ${GAP_PX}px)`,
          }}
        >
          {blockLabel(c().type)}
          <kbd>{K(BLOCK_HOTKEYS[c().type])}</kbd>
        </span>
      )}
    </Show>
  );
}

export default GutterLabel;
