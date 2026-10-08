import { For, Index, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount, type Accessor } from "solid-js";
import type { LexicalEditor } from "lexical";
import { account } from "@agentz/kit/account";
import { sameData } from "@agentz/kit/lib";
import { getPlatformAdapter } from "@agentz/kit/platform";
import { pushToast } from "@agentz/kit/stores";
import { Icon } from "@agentz/kit/ui";
import { t, tPlural } from "../../i18n";
import { CLAIM_THRESHOLD, claimWindow } from "../../lib/agent/claimScan";
import { sourceHost, type Claim, type ClaimVerdict } from "../../lib/agent/proposals";
import type { AgentBlock, AgentBlockType } from "../../lib/agent/scriptText";
import type { TimingBlock } from "../../lib/timing";
import { agentStore } from "../../stores/agent";
import {
  checkClaim, claimScanAllowed, clearCheck, createClaimScanner, ensureClaimAccess, lineState, loadResolved, resolveClaim, unresolveClaim,
  type ClaimCheck, type ClaimStep,
} from "../../stores/agent/claims";
import { localId } from "../../stores/agent/chatItems";
import { agentSettings } from "../../stores/agentSettings";
import { agentUi } from "../../stores/agentUi";
import { AgentAvatar } from "./AgentAvatar";
import { findQuoteRange } from "./ClaimMarks";
import { applyBlocks } from "./editorBridge";
import { agentErrorText } from "./ProviderSetup";
import { ScriptBlocks } from "./ScriptBlocks";
import "./ClaimSpots.css";

export interface ClaimSpotsProps {
  scriptId: string;
  editor: Accessor<LexicalEditor | null>;
  sheet: Accessor<HTMLElement | undefined>;
  /** Live blocks of the editor (debounced), with their Lexical keys. */
  blocks: Accessor<TimingBlock[]>;
  /** Bumps on every content change (lines may have moved). */
  tick: Accessor<number>;
  colorOf(name: string): string;
}

/** Quiet time after typing before new or edited lines are asked about. */
const SCAN_DEBOUNCE_MS = 2000;
const POP_W = 372;
/** Between the line and its result card. */
const GAP = 10;

const TYPE: Record<TimingBlock["kind"], AgentBlockType> = {
  action: "action",
  character: "character",
  dialog: "dialog",
  paren: "parenthetical",
};

const VERDICT_KEY: Record<ClaimVerdict, "agent.claim.correct" | "agent.claim.imprecise" | "agent.claim.wrong" | "agent.claim.unclear"> = {
  correct: "agent.claim.correct",
  imprecise: "agent.claim.imprecise",
  wrong: "agent.claim.wrong",
  unclear: "agent.claim.unclear",
};
const VERDICT_GLYPH: Record<ClaimVerdict, string> = { correct: "✓", imprecise: "≈", wrong: "✕", unclear: "?" };
const STEPS: ClaimStep[] = ["reading", "searching", "comparing"];
const STEP_KEY: Record<ClaimStep, "agent.spots.step.reading" | "agent.spots.step.searching" | "agent.spots.step.comparing"> = {
  reading: "agent.spots.step.reading",
  searching: "agent.spots.step.searching",
  comparing: "agent.spots.step.comparing",
};
const HIGHLIGHTS = ["ag-spot-flag", "ag-spot-hot", "ag-spot-checking", "ag-spot-correct", "ag-spot-imprecise", "ag-spot-wrong", "ag-spot-unclear"];

type SpotKind = "flag" | "running" | "done" | "failed";

interface Spot {
  /** Lexical key of the block. */
  key: string;
  index: number;
  text: string;
  kind: SpotKind;
  verdict: ClaimVerdict | null;
}

interface Placed {
  key: string;
  kind: SpotKind;
  verdict: ClaimVerdict | null;
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

function wholeBlock(el: HTMLElement): Range {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range;
}

function openSource(url: string) {
  void getPlatformAdapter().openUrl(url).catch((error) => console.warn("[agent] open source failed", error));
}

/**
 * Checkable claims on the paper (stores/agent/claims.ts). A line the
 * decision model marks gets a dotted underline and a ring in the right
 * margin; hovering the ring shows "Prüfen" and the lines that were read with
 * it. A click lets the agent fact-check the line right there: the result card
 * opens under the line, the line takes the verdict colour. Reads the
 * rendered editor, never its state; the Custom Highlight API draws the lines.
 */
export function ClaimSpots(props: ClaimSpotsProps) {
  const api = highlightApi();
  const scanner = createClaimScanner(props.scriptId);
  const [placed, setPlaced] = createSignal<Placed[]>([], { equals: sameData });
  const [hot, setHot] = createSignal<string | null>(null);
  const [rail, setRail] = createSignal<{ top: number; height: number } | null>(null, { equals: sameData });
  const [open, setOpen] = createSignal<string | null>(null);
  const [popPos, setPopPos] = createSignal<{ top: number; left: number; arrow: number; above: boolean } | null>(null, { equals: sameData });
  let popRef: HTMLDivElement | undefined;
  /** The card was opened or changed size: scroll it fully into view once. */
  let reveal = false;
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scanned = false;

  const agentBlocks = (): AgentBlock[] => props.blocks().map((block) => ({ type: TYPE[block.kind], text: block.text }));

  onMount(() => {
    ensureClaimAccess();
    void loadResolved(props.scriptId);
  });
  createEffect(on(() => account.signedIn(), (signedIn) => { if (signedIn) ensureClaimAccess(); }, { defer: true }));

  // Opening: everything at once. Typing: new and edited lines after a pause.
  createEffect(on([props.blocks, claimScanAllowed] as const, ([blocks, allowed]) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!allowed || blocks.length === 0) return;
    const delay = scanned ? SCAN_DEBOUNCE_MS : 0;
    scanned = true;
    timer = setTimeout(() => { timer = null; scanner.update(agentBlocks()); }, delay);
  }));

  const spots = createMemo<Spot[]>(() => {
    if (!claimScanAllowed()) return [];
    const out: Spot[] = [];
    props.blocks().forEach((block, index) => {
      if (block.kind !== "dialog" || !block.key) return;
      const line = lineState(props.scriptId, block.text);
      if (line.resolved) return;
      const check = line.check;
      if (check) {
        const verdict = check.state === "done" ? check.claim?.verdict ?? null : null;
        out.push({ key: block.key, index, text: block.text, kind: check.state === "running" ? "running" : check.state, verdict });
      } else if ((line.probability ?? 0) >= CLAIM_THRESHOLD) {
        out.push({ key: block.key, index, text: block.text, kind: "flag", verdict: null });
      }
    });
    return out;
  }, [], { equals: sameData });

  const spotOf = (key: string | null) => (key ? spots().find((spot) => spot.key === key) ?? null : null);
  const checkOf = (spot: Spot | null): ClaimCheck | null => (spot ? lineState(props.scriptId, spot.text).check : null);

  const clearHighlights = () => {
    if (api) for (const name of HIGHLIGHTS) api.registry.delete(name);
  };

  const measure = () => {
    raf = 0;
    const ed = props.editor();
    const sheet = props.sheet();
    clearHighlights();
    if (!ed || !sheet || spots().length === 0) {
      setPlaced([]);
      setRail(null);
      setPopPos(null);
      return;
    }
    const base = sheet.getBoundingClientRect();
    const ranges = new Map<string, Range[]>();
    const add = (name: string, range: Range) => ranges.set(name, [...(ranges.get(name) ?? []), range]);
    const next: Placed[] = [];
    for (const spot of spots()) {
      const el = ed.getElementByKey(spot.key);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next.push({ key: spot.key, kind: spot.kind, verdict: spot.verdict, top: r.top - base.top + 3, left: r.right - base.left + 14 });
      if (spot.kind === "done") {
        const claim = checkOf(spot)?.state === "done" ? (checkOf(spot) as Extract<ClaimCheck, { state: "done" }>).claim : null;
        if (claim) add(`ag-spot-${claim.verdict}`, findQuoteRange(el, claim.quote) ?? wholeBlock(el));
      } else if (spot.kind === "running") {
        add("ag-spot-checking", wholeBlock(el));
      } else {
        add(hot() === spot.key ? "ag-spot-hot" : "ag-spot-flag", wholeBlock(el));
      }
    }
    if (api) for (const [name, list] of ranges) api.registry.set(name, new api.Highlight(...list));
    setPlaced(next);

    // The lines read together with the hovered one.
    const hovered = spotOf(hot());
    if (hovered && hovered.kind === "flag") {
      const { from, to } = claimWindow(agentBlocks(), hovered.index);
      const first = props.blocks()[from]?.key;
      const last = props.blocks()[to]?.key;
      const a = first ? ed.getElementByKey(first) : null;
      const b = last ? ed.getElementByKey(last) : null;
      if (a && b) {
        const top = a.getBoundingClientRect().top - base.top - 2;
        setRail({ top, height: b.getBoundingClientRect().bottom - base.top + 2 - top });
      } else setRail(null);
    } else setRail(null);

    const opened = spotOf(open());
    const anchor = opened ? ed.getElementByKey(opened.key) : null;
    if (anchor) {
      const rects = anchor.getClientRects();
      const firstRect = rects[0] ?? anchor.getBoundingClientRect();
      const lastRect = rects[rects.length - 1] ?? firstRect;
      const left = Math.max(16, Math.min(firstRect.left - base.left - 8, base.width - POP_W - 16));
      // Below the line, unless the visible paper ends before the card does
      // and there is more room above (a line near the bottom edge).
      const view = (sheet.closest(".paper-canvas") ?? sheet).getBoundingClientRect();
      const height = popRef?.offsetHeight ?? 0;
      const below = view.bottom - lastRect.bottom - GAP;
      const above = firstRect.top - view.top - GAP;
      const up = height > below && above > below;
      const top = up ? firstRect.top - base.top - GAP - height : lastRect.bottom - base.top + GAP;
      setPopPos({ top, left, arrow: Math.max(14, Math.min(firstRect.left - base.left - left + 10, POP_W - 30)), above: up });
      // Room on neither side: the paper scrolls until the whole card shows.
      if (reveal && height > 0) {
        reveal = false;
        const canvas = sheet.closest(".paper-canvas");
        const cardTop = base.top + top;
        const overBottom = cardTop + height + GAP - view.bottom;
        const overTop = view.top - (cardTop - GAP);
        // Down at most until the line reaches the top edge (it stays in view).
        if (canvas && overBottom > 0) canvas.scrollBy({ top: Math.min(overBottom, Math.max(0, firstRect.top - view.top - GAP)), behavior: "smooth" });
        else if (canvas && overTop > 0) canvas.scrollBy({ top: -overTop, behavior: "smooth" });
      }
    } else {
      setPopPos(null);
    }
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(measure);
  };

  createEffect(() => {
    props.tick();
    spots();
    hot();
    open();
    props.editor();
    schedule();
  });
  createEffect(() => {
    const sheet = props.sheet();
    if (!sheet || typeof ResizeObserver === "undefined") return;
    // The canvas too: opening the chat moves the sheet without resizing it.
    const ro = new ResizeObserver(() => schedule());
    ro.observe(sheet);
    const canvas = sheet.closest(".paper-canvas");
    if (canvas) ro.observe(canvas);
    onCleanup(() => ro.disconnect());
  });
  // The open card changes size (loading -> result) and scrolling changes the
  // room above and below it: both place it again.
  createEffect(() => {
    const sheet = props.sheet();
    if (!open() || !sheet) return;
    const canvas = sheet.closest(".paper-canvas");
    canvas?.addEventListener("scroll", schedule, { passive: true });
    onCleanup(() => canvas?.removeEventListener("scroll", schedule));
  });
  // A line that left the paper (deleted, edited, resolved) closes its card.
  createEffect(() => { if (open() && !spotOf(open())) setOpen(null); });

  onMount(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!open() || target?.closest(".ag-spot-pop") || target?.closest(".ag-spot")) return;
      setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open()) { event.preventDefault(); setOpen(null); }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    });
  });

  onCleanup(() => {
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    scanner.dispose();
    clearHighlights();
  });

  // ------------------------------------------------------------- actions

  const onMarker = (key: string) => {
    const spot = spotOf(key);
    if (!spot) return;
    setHot(null);
    if (spot.kind === "flag" || spot.kind === "failed") void checkClaim(props.scriptId, spot.index, spot.text);
    reveal = true;
    setOpen(open() === key && spot.kind !== "flag" ? null : key);
  };

  const done = (spot: Spot, kept: boolean) => {
    const check = checkOf(spot);
    resolveClaim(props.scriptId, spot.text);
    setOpen(null);
    pushToast(t(kept ? "agent.spots.toast.kept" : "agent.spots.toast.done"), "info", undefined, {
      action: { label: t("agent.spots.undo"), run: () => unresolveClaim(props.scriptId, spot.text, check) },
    });
  };

  const apply = (spot: Spot, claim: Claim) => {
    const fix = claim.fix;
    if (!fix || !applyBlocks(props.scriptId, fix.blocks, fix.target)) {
      pushToast(t("agent.spots.toast.applyFailed"), "error");
      return;
    }
    resolveClaim(props.scriptId, spot.text);
    // The corrected line still holds the claim: it is checked already.
    for (const block of fix.blocks) if (block.type === "dialog") resolveClaim(props.scriptId, block.text);
    setOpen(null);
    pushToast(t("agent.spots.toast.applied"), "ok");
  };

  const toChat = async (spot: Spot, claim: Claim) => {
    const session = await agentStore.sessionFor(props.scriptId);
    session.append([
      { kind: "user", id: localId("user"), text: t("agent.spots.chatAsk"), quote: spot.text },
      { kind: "claims", id: localId("claims"), claims: [claim], applied: [] },
    ]);
    // The chat holds the result from now on; the paper shows it there.
    resolveClaim(props.scriptId, spot.text);
    setOpen(null);
    agentUi.setChatOpen(props.scriptId, true);
  };

  /** The fix as on the paper: with the speaker's name, so the preview has
   *  the character's colour. */
  const fixPreview = (spot: Spot, blocks: readonly AgentBlock[]): AgentBlock[] => {
    if (blocks[0]?.type === "character" || blocks[0]?.type === "action") return [...blocks];
    const all = props.blocks();
    for (let i = spot.index; i >= 0; i--) {
      if (all[i]?.kind === "character") return [{ type: "character", text: all[i].text }, ...blocks];
      if (all[i]?.kind === "action") break;
    }
    return [...blocks];
  };

  const retry = (spot: Spot) => void checkClaim(props.scriptId, spot.index, spot.text);
  const dismissFailure = (spot: Spot) => {
    clearCheck(props.scriptId, spot.text);
    setOpen(null);
  };

  // ---------------------------------------------------------------- view

  const markerLabel = (item: Placed) => {
    if (item.kind === "flag") return t("agent.spots.check");
    if (item.kind === "running") return t("agent.spots.checking", { name: agentSettings.displayName() });
    if (item.kind === "failed") return t("agent.spots.failed");
    return item.verdict ? t("agent.spots.result", { verdict: t(VERDICT_KEY[item.verdict]) }) : t("agent.spots.none");
  };

  const openedSpot = () => spotOf(open());
  const openedCheck = () => checkOf(openedSpot());

  return (
    <>
      <Show when={rail()}>
        {(r) => (
          <div class="ag-spot-rail" style={{ top: `${r().top}px`, height: `${r().height}px` }} aria-hidden="true">
            <span>{t("agent.spots.context")}</span>
          </div>
        )}
      </Show>
      <Index each={placed()}>
        {(item) => (
          <button
            type="button"
            class={`ag-spot is-${item().kind}`}
            classList={{ [`is-${item().verdict}`]: !!item().verdict }}
            style={{ top: `${item().top}px`, left: `${item().left}px` }}
            aria-label={markerLabel(item())}
            title={markerLabel(item())}
            onMouseEnter={() => item().kind === "flag" && setHot(item().key)}
            onMouseLeave={() => hot() === item().key && setHot(null)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onMarker(item().key)}
          >
            <Switch>
              <Match when={item().kind === "flag"}>
                <Icon name="search" size={9} />
                <span class="ag-spot-lbl">{t("agent.spots.check")}</span>
              </Match>
              <Match when={item().kind === "done"}>{item().verdict ? VERDICT_GLYPH[item().verdict as ClaimVerdict] : "–"}</Match>
              <Match when={item().kind === "failed"}>!</Match>
            </Switch>
          </button>
        )}
      </Index>
      <Show when={openedSpot() && openedCheck()}>
        <div
          ref={(el) => {
            popRef = el;
            if (typeof ResizeObserver === "undefined") return;
            const ro = new ResizeObserver(() => { reveal = true; schedule(); });
            ro.observe(el);
            onCleanup(() => ro.disconnect());
          }}
          class="ag-spot-pop"
          classList={{ "is-above": !!popPos()?.above, "is-placing": !popPos() }}
          role="dialog"
          aria-label={t("agent.claims.title")}
          style={{ top: `${popPos()?.top ?? 0}px`, left: `${popPos()?.left ?? 0}px`, "--arrow": `${popPos()?.arrow ?? 24}px` }}
          onMouseDown={(event) => { if (!(event.target as Element).closest("button")) event.preventDefault(); }}
        >
          <Switch>
            <Match when={openedCheck()?.state === "running" && (openedCheck() as Extract<ClaimCheck, { state: "running" }>)}>
              {(check) => (
                <>
                  <div class="ag-spot-h">
                    <AgentAvatar look={agentSettings.look()} size={16} />
                    <b>{t("agent.spots.checking", { name: agentSettings.displayName() })}</b>
                  </div>
                  <ul class="ag-spot-steps">
                    <For each={STEPS}>
                      {(step, i) => {
                        const at = () => STEPS.indexOf(check().step);
                        return (
                          <li classList={{ "is-done": i() < at(), "is-now": i() === at() }}>
                            <i aria-hidden="true" />
                            {t(STEP_KEY[step])}
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </>
              )}
            </Match>
            <Match when={openedCheck()?.state === "failed" && (openedCheck() as Extract<ClaimCheck, { state: "failed" }>)}>
              {(check) => (
                <>
                  <p class="ag-spot-x">{agentErrorText(check().error) ?? t("agent.spots.failed")}</p>
                  <div class="ag-spot-acts">
                    <button type="button" class="btn" onClick={() => { const spot = openedSpot(); if (spot) retry(spot); }}>{t("agent.spots.retry")}</button>
                    <span class="ag-spot-sp" />
                    <button type="button" class="btn ghost" onClick={() => { const spot = openedSpot(); if (spot) dismissFailure(spot); }}>{t("common.close")}</button>
                  </div>
                </>
              )}
            </Match>
            <Match when={openedCheck()?.state === "done" && (openedCheck() as Extract<ClaimCheck, { state: "done" }>)}>
              {(check) => (
                <Show
                  when={check().claim}
                  fallback={
                    <>
                      <p class="ag-spot-x">{check().note || t("agent.spots.none")}</p>
                      <div class="ag-spot-acts">
                        <button type="button" class="btn" onClick={() => { const spot = openedSpot(); if (spot) done(spot, false); }}>{t("agent.spots.done")}</button>
                      </div>
                    </>
                  }
                >
                  {(claim) => (
                    <>
                      <div class="ag-spot-h">
                        <span class={`ag-verdict is-${claim().verdict}`}>{t(VERDICT_KEY[claim().verdict])}</span>
                        <Show when={claim().sources.length > 0}>
                          <span class="ag-spot-src">{tPlural("agent.claims.sum.sources", claim().sources.length)}</span>
                        </Show>
                      </div>
                      <Show when={claim().explanation}>
                        <p class="ag-spot-x">{claim().explanation}</p>
                      </Show>
                      <Show when={claim().sources.length > 0}>
                        <div class="ag-src" aria-label={t("agent.claim.sources")}>
                          <For each={claim().sources}>
                            {(source) => (
                              <button type="button" class="ag-src-chip" title={source.url} onClick={() => openSource(source.url)}>
                                <span class="ag-src-ic">{sourceHost(source.url).slice(0, 1).toUpperCase()}</span>
                                <b>{sourceHost(source.url)}</b>
                                <Show when={source.title && source.title !== sourceHost(source.url)}>
                                  <span>{source.title}</span>
                                </Show>
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                      <Show when={claim().fix}>
                        {(fix) => (
                          <>
                            <span class="ag-spot-l">{t("agent.spots.fix")}</span>
                            <ScriptBlocks blocks={fixPreview(openedSpot() as Spot, fix().blocks)} colorOf={props.colorOf} />
                          </>
                        )}
                      </Show>
                      <div class="ag-spot-acts">
                        <Show
                          when={claim().fix}
                          fallback={
                            <button type="button" class="btn" onClick={() => { const spot = openedSpot(); if (spot) done(spot, false); }}>{t("agent.spots.done")}</button>
                          }
                        >
                          <button type="button" class="btn accent" onClick={() => { const spot = openedSpot(); if (spot) apply(spot, claim()); }}>{t("agent.spots.apply")}</button>
                          <button type="button" class="btn" onClick={() => { const spot = openedSpot(); if (spot) done(spot, true); }}>{t("agent.spots.keep")}</button>
                        </Show>
                        <span class="ag-spot-sp" />
                        <button type="button" class="btn ghost ag-spot-chat" onClick={() => { const spot = openedSpot(); if (spot) void toChat(spot, claim()); }}>{t("agent.spots.inChat")}</button>
                      </div>
                    </>
                  )}
                </Show>
              )}
            </Match>
          </Switch>
        </div>
      </Show>
    </>
  );
}
