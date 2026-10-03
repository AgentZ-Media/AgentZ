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

/** Where the label sits: `left: null` = in the canvas margin outside the
 *  paper; a number = inside the paper's left margin (px from the sheet). */
interface GutterPos {
  top: number;
  left: number | null;
}

/**
 * Yellow block-type label level with the caret block ("Charakter ⌘2"). Sits
 * in the canvas margin left of the paper; when that margin is too narrow
 * (the usual case with sidebar + inspector open next to the A4 sheet) it
 * moves into the paper's own left margin, just before the block's text.
 * Only one at a time, only while the editor has focus, hidden when neither
 * spot can hold it.
 */
export function GutterLabel(props: GutterLabelProps) {
  const [pos, setPos] = createSignal<GutterPos | null>(null);
  let labelRef: HTMLSpanElement | undefined;
  let raf = 0;

  const measure = () => {
    raf = 0;
    const ed = props.editor();
    const caret = props.caret();
    const sheet = props.sheet();
    if (!ed || !caret || !sheet || !props.focused()) {
      setPos(null);
      return;
    }
    const el = ed.getElementByKey(caret.key);
    if (!el) {
      setPos(null);
      return;
    }
    const sheetRect = sheet.getBoundingClientRect();
    const canvas = sheet.parentElement;
    const room = canvas ? sheetRect.left - canvas.getBoundingClientRect().left : 0;
    const width = labelRef?.offsetWidth ?? 110;
    const r = el.getBoundingClientRect();
    // Centre the 20 px label on the block's first line.
    const lineH = parseFloat(getComputedStyle(el).lineHeight) || 22;
    const top = r.top - sheetRect.top + Math.max(0, (lineH - 20) / 2);
    if (room >= width + GAP_PX + 8) {
      setPos({ top, left: null });
      return;
    }
    // Inside the paper: right edge a gap before where the block's text
    // starts (centred Character names and indented Dialog leave more room
    // than Action, which starts at the paper margin).
    const textLeft = textStartX(el) - sheetRect.left;
    const left = textLeft - GAP_PX - width;
    setPos(left >= 4 ? { top, left } : null);
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
            top: `${pos()?.top ?? 0}px`,
            visibility: pos() === null ? "hidden" : "visible",
            ...(pos()?.left != null
              ? { left: `${pos()?.left}px` }
              : { right: `calc(100% + ${GAP_PX}px)` }),
          }}
        >
          {blockLabel(c().type)}
          <kbd>{K(BLOCK_HOTKEYS[c().type])}</kbd>
        </span>
      )}
    </Show>
  );
}

/** Viewport x where the block's first line of text begins. Uses the first
 *  rendered inline box (an empty block still renders its placeholder line);
 *  falls back to the block's content box. */
function textStartX(el: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(el);
  const first = Array.from(range.getClientRects()).find((rc) => rc.width > 0 || rc.height > 0);
  range.detach();
  if (first) return first.left;
  const r = el.getBoundingClientRect();
  return r.left + (parseFloat(getComputedStyle(el).paddingLeft) || 0);
}

export default GutterLabel;
