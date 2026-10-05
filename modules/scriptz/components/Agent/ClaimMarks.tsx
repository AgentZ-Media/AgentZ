import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import type { LexicalEditor } from "lexical";
import type { Claim, ClaimVerdict } from "../../lib/agent/proposals";
import { agentStore } from "../../stores/agent";
import { t } from "../../i18n";

export interface ClaimMarksProps {
  scriptId: string;
  editor: Accessor<LexicalEditor | null>;
  sheet: Accessor<HTMLElement | undefined>;
  /** Bumps on every editor update (text may have moved). */
  tick: Accessor<number>;
  /** Only while the chat is open. */
  active: Accessor<boolean>;
}

const VERDICTS: ClaimVerdict[] = ["correct", "imprecise", "wrong", "unclear"];
const VERDICT_KEY: Record<ClaimVerdict, "agent.claim.correct" | "agent.claim.imprecise" | "agent.claim.wrong" | "agent.claim.unclear"> = {
  correct: "agent.claim.correct",
  imprecise: "agent.claim.imprecise",
  wrong: "agent.claim.wrong",
  unclear: "agent.claim.unclear",
};

interface Dot {
  n: number;
  verdict: ClaimVerdict;
  top: number;
  left: number;
}

type HighlightRegistry = Map<string, unknown>;
type HighlightCtor = new (...ranges: Range[]) => unknown;

function highlightApi(): { registry: HighlightRegistry; Highlight: HighlightCtor } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Highlight = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  return css?.highlights && Highlight ? { registry: css.highlights, Highlight } : null;
}

const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Finds `quote` inside a block element and returns a DOM range over it
 *  (whitespace and case are ignored). */
export function findQuoteRange(el: HTMLElement, quote: string): Range | null {
  const wanted = norm(quote.replace(/^["„“”']+|["„“”']+$/g, ""));
  if (wanted.length < 3) return null;
  // Flatten the text nodes (lower case, single spaces) and remember for
  // every flattened character where it came from.
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let flat = "";
  let lastSpace = true;
  const offsets: Array<{ node: Text; offset: number }> = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const value = node.data;
    for (let i = 0; i < value.length; i++) {
      const space = /\s/.test(value[i]);
      if (space && lastSpace) continue;
      flat += space ? " " : value[i].toLowerCase();
      offsets.push({ node, offset: i });
      lastSpace = space;
    }
  }
  const at = flat.indexOf(wanted);
  if (at < 0) return null;
  const from = offsets[at];
  const to = offsets[at + wanted.length - 1];
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset + 1);
  return range;
}

/**
 * Fact-check results on the paper: every checked claim of the latest fact
 * check is underlined in its verdict colour and numbered like the card in
 * the chat. Uses the CSS Custom Highlight API (no DOM or editor changes);
 * where the web view lacks it, only the numbers are shown.
 */
export function ClaimMarks(props: ClaimMarksProps) {
  const [dots, setDots] = createSignal<Dot[]>([]);
  const claims = createMemo<Claim[]>(() => {
    if (!props.active()) return [];
    const items = agentStore.session(props.scriptId).items;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === "claims") return item.claims;
    }
    return [];
  });
  const api = highlightApi();
  const clearHighlights = () => {
    if (!api) return;
    for (const verdict of VERDICTS) api.registry.delete(`ag-claim-${verdict}`);
  };
  let raf = 0;

  const measure = () => {
    raf = 0;
    const ed = props.editor();
    const root = ed?.getRootElement();
    const sheet = props.sheet();
    const list = claims();
    clearHighlights();
    if (!root || !sheet || list.length === 0) {
      setDots([]);
      return;
    }
    const base = sheet.getBoundingClientRect();
    const byVerdict = new Map<ClaimVerdict, Range[]>();
    const next: Dot[] = [];
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(":scope > .block"));
    list.forEach((claim, index) => {
      for (const block of blocks) {
        const range = findQuoteRange(block, claim.quote);
        if (!range) continue;
        const ranges = byVerdict.get(claim.verdict) ?? [];
        ranges.push(range);
        byVerdict.set(claim.verdict, ranges);
        const rects = Array.from(range.getClientRects());
        const last = rects[rects.length - 1];
        if (last) next.push({ n: index + 1, verdict: claim.verdict, top: last.top - base.top - 7, left: last.right - base.left + 1 });
        break;
      }
    });
    if (api) {
      for (const [verdict, ranges] of byVerdict) api.registry.set(`ag-claim-${verdict}`, new api.Highlight(...ranges));
    }
    setDots(next);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(measure);
  };

  createEffect(() => {
    props.tick();
    claims();
    props.editor();
    schedule();
  });
  createEffect(() => {
    const sheet = props.sheet();
    if (!sheet || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => schedule());
    ro.observe(sheet);
    onCleanup(() => ro.disconnect());
  });
  onCleanup(() => {
    if (raf) cancelAnimationFrame(raf);
    clearHighlights();
  });

  return (
    <Show when={dots().length > 0}>
      <For each={dots()}>
        {(dot) => (
          <i
            class={`ag-fc-dot ag-fc-mark is-${dot.verdict}`}
            role="img"
            aria-label={t("agent.claims.marker", { n: dot.n, verdict: t(VERDICT_KEY[dot.verdict]) })}
            style={{ top: `${dot.top}px`, left: `${dot.left}px` }}
          >
            {dot.n}
          </i>
        )}
      </For>
    </Show>
  );
}

export default ClaimMarks;
