import { For, Show, createMemo, createSignal } from "solid-js";
import type { ScriptCharacter, ScriptSummary } from "../../lib/types";
import { relativeTime } from "@agentz/kit/lib";
import { formatClock, formatRange, lengthStatus } from "../../lib/lengthGoal";
import { isValidHexColor } from "../../lib/colors";
import { K } from "@agentz/kit/platform";
import { StageGlyph } from "../Common/StageGlyph";
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

/** Character chip colours: the character colour mixed onto the surface
 *  (like the paper highlight) and a darker ink of the same hue. Colours are
 *  content data, validated before they reach a style attribute. */
function chipStyle(color: string): Record<string, string> | undefined {
  if (!isValidHexColor(color)) return undefined;
  return {
    background: `color-mix(in srgb, ${color} 26%, var(--surface))`,
    color: `color-mix(in srgb, ${color} 72%, var(--fg))`,
  };
}

/** Row of the scripts overview (concept `.row`): stage glyph, title +
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
    return { label: formatClock(sec), over: st.state === "over", title };
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
          activate(e);
        }
      }}
    >
      <span class="lrow-glyph">
        <Show
          when={props.selectMode}
          fallback={<StageGlyph stage={s().status} />}
        >
          <span class="lrow-check" aria-hidden="true">
            <Show when={props.selected}>
              <Icon name="check" size={11} />
            </Show>
          </span>
        </Show>
      </span>
      <div class="lrow-t">
        <span class="lrow-title">{title()}</span>
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
            <span class="who" style={chipStyle(c.color)}>
              {c.name}
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
        {runtime()?.label ?? ""}
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
