import { For, Show, createMemo, createSignal } from "solid-js";
import type { ScriptCharacter, ScriptSummary } from "../../lib/types";
import { relativeTime } from "@agentz/kit/lib";
import { formatClock, formatRange, lengthStatus, runtimeBar } from "../../lib/lengthGoal";
import { isValidHexColor } from "../../lib/colors";
import { K } from "@agentz/kit/platform";
import { StageGlyph } from "../Common/StageGlyph";
import { rememberOpenSource } from "../Common/motion";
import { Icon } from "@agentz/kit/ui";
import { library, lengthRangeFor, runtimeSecFor } from "../Shell/libraryData";
import { SCRIPT_DRAG_MIME } from "./dnd";
import { t } from "../../i18n";

export interface ScriptRowProps {
  script: ScriptSummary;
  /** Overrides the idea subtitle, e.g. a full-text snippet (safe HTML). */
  snippetHtml?: string;
  selectMode: boolean;
  selected: boolean;
  /** Shown in the side panel right now (row is marked). */
  peek?: boolean;
  /** Row click / Enter. `inverse`: Alt-click, open the other way than the
   *  "open in side panel" setting says. */
  onOpen: (inverse: boolean) => void;
  /** The row's open button: always the full script view. */
  onOpenFull?: () => void;
  /** Gets the triggering event so shift-click can select a range. */
  onToggleSelect: (e?: MouseEvent | KeyboardEvent) => void;
  /** Opens the row menu. `anchor` is set when triggered from the "⋯" button. */
  onMenu: (e: MouseEvent, anchor?: HTMLElement) => void;
}

const MAX_CAST = 3;

/** Characters ordered by dialog share, biggest speaker first. */
function castOf(chars: ScriptCharacter[]): ScriptCharacter[] {
  return [...chars].sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
}

/** Face of a character: its colour as a small lit disc. Colours are
 *  content data, validated before they reach a style attribute. */
function faceStyle(color: string): Record<string, string> | undefined {
  if (!isValidHexColor(color)) return undefined;
  return { "--who": color };
}

/** First letter of a character name, for its face. */
function initial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?";
}

type ThumbLine = { kind: "act" | "who" | "say"; color?: string };

/** A tiny page for the row: action lines, speakers in their colour and
 *  their dialogue, in a rhythm derived from the script id. Decorative. */
function thumbLines(id: string, cast: ScriptCharacter[]): ThumbLine[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const colors = cast.map((c) => c.color).filter(isValidHexColor);
  const lines: ThumbLine[] = [];
  let speaker = 0;
  while (lines.length < 6) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    if (colors.length && (h & 3) !== 0 && lines.length < 5) {
      lines.push({ kind: "who", color: colors[speaker++ % colors.length] }, { kind: "say" });
    } else {
      lines.push({ kind: "act" });
    }
  }
  return lines.slice(0, 6);
}

/** Row of the scripts overview: stage glyph, title +
 *  subtitle, folder, cast, runtime vs. target range, last edit. Hovering
 *  swaps the date for "open" and "⋯". */
export function ScriptRow(props: ScriptRowProps) {
  const [dragging, setDragging] = createSignal(false);
  const s = () => props.script;

  const folderName = () => library.folder(s().folder_id)?.name ?? "";
  const subtitle = () => library.ideaLine(s().id);
  const cast = createMemo(() => castOf(s().characters));

  const runtime = createMemo(() => {
    const sec = runtimeSecFor(s());
    if (sec === null) return null;
    const range = lengthRangeFor(s());
    const st = lengthStatus(sec, range);
    const rangeLabel = formatRange(range);
    let title = "";
    if (st.state === "over") title = t("shell.length.over", { delta: st.deltaSec, range: rangeLabel });
    else if (st.state === "under") title = t("shell.length.under", { delta: st.deltaSec, range: rangeLabel });
    else if (st.state === "in") title = t("shell.length.in", { range: rangeLabel });
    return { label: formatClock(sec), over: st.state === "over", title, bar: runtimeBar(sec, range) };
  });

  const activate = (e?: MouseEvent | KeyboardEvent) =>
    props.selectMode ? props.onToggleSelect(e) : props.onOpen(e?.altKey ?? false);
  const title = () => s().title || t("common.untitled");

  return (
    <div
      class="lrow"
      role="button"
      tabIndex={0}
      classList={{
        "is-selecting": props.selectMode,
        "is-selected": props.selectMode && props.selected,
        "is-dragging": dragging(),
        "is-peek": !!props.peek && !props.selectMode,
      }}
      aria-label={title()}
      aria-pressed={props.selectMode ? props.selected : undefined}
      draggable={!props.selectMode}
      onDragStart={(e) => {
        if (props.selectMode || !e.dataTransfer) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(SCRIPT_DRAG_MIME, s().id);
        e.dataTransfer.setData("text/plain", title());
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={(e) => {
        rememberOpenSource(e.currentTarget);
        if (!props.selectMode && (e.shiftKey || e.metaKey || e.ctrlKey)) {
          // Modifier click starts / extends a selection, like a file list.
          props.onToggleSelect(e);
          return;
        }
        activate(e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu(e);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          rememberOpenSource(e.currentTarget);
          activate(e);
        }
      }}
    >
      <span class="lrow-glyph">
        <Show
          when={props.selectMode}
          fallback={<StageGlyph stage={s().status} class={library.justFinished(s().id) ? "is-finishing" : undefined} />}
        >
          <span class="lrow-check" aria-hidden="true">
            <Show when={props.selected}>
              <Icon name="check" size={11} />
            </Show>
          </span>
        </Show>
      </span>
      <span class="lrow-thumb" aria-hidden="true">
        <For each={thumbLines(s().id, cast())}>
          {(line) => <i class={`is-${line.kind}`} style={line.color ? { "--who": line.color } : undefined} />}
        </For>
      </span>
      <div class="lrow-t">
        <span class="lrow-title">
          <span classList={{ "mo-marker": library.justFinished(s().id) }}>{title()}</span>
        </span>
        <Show
          when={props.snippetHtml}
          fallback={
            <Show when={subtitle()}>
              <small>{subtitle()}</small>
            </Show>
          }
        >
          <small class="lrow-snippet" innerHTML={props.snippetHtml} />
        </Show>
      </div>
      <div class="lrow-f">{folderName()}</div>
      <div class="lrow-cast">
        <For each={cast().slice(0, MAX_CAST)}>
          {(c) => (
            <span class="who" style={faceStyle(c.color)} title={c.name}>
              {initial(c.name)}
            </span>
          )}
        </For>
        <Show when={cast().length > MAX_CAST}>
          <span class="who-more">+{cast().length - MAX_CAST}</span>
        </Show>
      </div>
      <div
        class="lrow-rt"
        classList={{ over: runtime()?.over ?? false }}
        title={runtime()?.title || undefined}
      >
        <span class="lrow-rt-t">{runtime()?.label ?? ""}</span>
        <Show when={runtime()?.bar}>
          {(bar) => (
            <span class="lrow-rt-bar" aria-hidden="true" style={{
              "--from": bar().from.toFixed(3), "--to": bar().to.toFixed(3), "--fill": bar().fill.toFixed(3),
            }}>
              <i />
            </span>
          )}
        </Show>
      </div>
      <div class="lrow-u">{relativeTime(s().updated_at)}</div>
      <Show when={!props.selectMode}>
        <div class="lrow-act">
          <button
            type="button"
            class="lrow-act-btn"
            title={t("shell.row.open", { hotkey: K("Enter") })}
            aria-label={t("script.menu.open")}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              rememberOpenSource(e.currentTarget.closest(".lrow"));
              if (props.onOpenFull) props.onOpenFull();
              else props.onOpen(false);
            }}
          >
            <Icon name="return" size={13} />
          </button>
          <button
            type="button"
            class="lrow-act-btn"
            title={t("browser.rowMore")}
            aria-label={t("browser.rowMore")}
            onClick={(e) => {
              e.stopPropagation();
              props.onMenu(e, e.currentTarget);
            }}
          >
            <Icon name="dots" size={14} />
          </button>
        </div>
      </Show>
    </div>
  );
}
