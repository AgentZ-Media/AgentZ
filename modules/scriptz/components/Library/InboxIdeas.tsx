import { For, Show, createSignal } from "solid-js";
import { relativeTime } from "@agentz/kit/lib";
import { K } from "@agentz/kit/platform";
import { Icon } from "@agentz/kit/ui";
import type { Idea } from "../../lib/types";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { t, tPlural } from "../../i18n";
import { StageGlyph } from "../Common/StageGlyph";
import { library } from "../Shell/libraryData";
import { libraryPrefs, type IdeaColumns } from "./prefs";

/** Ideas listed before "show more", per column layout. */
const IDEA_LIMIT: Record<IdeaColumns, number> = { 1: 10, 2: 20 };

/** First non-empty line of the idea notes (row subtitle). */
function firstLine(notes: string | null | undefined): string {
  return (
    (notes ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ""
  );
}

/** Opens the ideas page with this idea selected (filters that hide it are
 *  cleared by the page, like the palette does). */
export function openIdea(idea: Idea): void {
  uiStore.revealIdea(idea.id);
  void navStore.openIdeas(idea.folder_id);
}

/** "Ideen" group of the inbox, below the scripts that are still in
 *  progress: the newest open ideas as compact rows in one or two columns
 *  (filled left, right, left, ...), the rest behind "show more". A filter
 *  lists every match. */
export function InboxIdeas(props: {
  ideas: Idea[];
  closed: boolean;
  canCollapse: boolean;
  filtered: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const columns = () => libraryPrefs.ideaColumns();
  const limit = () => IDEA_LIMIT[columns()];
  const capped = () => !props.filtered && props.ideas.length > limit();
  const shown = () => (capped() && !expanded() ? props.ideas.slice(0, limit()) : props.ideas);
  const hidden = () => props.ideas.length - shown().length;

  return (
    <section class="grp" classList={{ "is-closed": props.closed }}>
      <div class="grp-h">
        <button
          type="button"
          class="grp-tog"
          aria-expanded={!props.closed}
          disabled={!props.canCollapse}
          title={
            props.canCollapse
              ? props.closed
                ? t("shell.group.expand")
                : t("shell.group.collapse")
              : undefined
          }
          onClick={() => props.onToggle()}
        >
          <Show when={props.canCollapse}>
            <Icon
              name={props.closed ? "right" : "down"}
              size={11}
              class={props.closed ? "chev is-shown" : "chev"}
            />
          </Show>
          <StageGlyph stage="idea" />
          <span>{t("shell.nav.ideas")}</span>
          <span class="n num">{props.ideas.length}</span>
        </button>
        <span class="grp-sp" />
        <Show when={!props.closed}>
          <div class="grp-cols" role="group" aria-label={t("shell.inbox.ideasLayout")}>
            <ColumnsButton columns={1} />
            <ColumnsButton columns={2} />
          </div>
        </Show>
        <button type="button" class="grp-act" onClick={() => void navStore.openIdeas()}>
          {t("shell.teaser.open")}
          <Icon name="right" size={12} />
        </button>
      </div>
      <Show when={!props.closed}>
        <div class="rows irows" classList={{ "is-two": columns() === 2 }}>
          <For each={shown()}>{(idea) => <IdeaRow idea={idea} />}</For>
          <Show when={capped()}>
            <button type="button" class="irows-more" onClick={() => setExpanded((v) => !v)}>
              {expanded() ? t("shell.inbox.fewerIdeas") : tPlural("shell.inbox.moreIdeas", hidden())}
              <Icon name={expanded() ? "up" : "down"} size={12} />
            </button>
          </Show>
        </div>
      </Show>
    </section>
  );
}

function ColumnsButton(props: { columns: IdeaColumns }) {
  const label = () => (props.columns === 1 ? t("shell.inbox.oneColumn") : t("shell.inbox.twoColumns"));
  return (
    <button
      type="button"
      title={label()}
      aria-label={label()}
      aria-pressed={libraryPrefs.ideaColumns() === props.columns}
      onClick={() => libraryPrefs.setIdeaColumns(props.columns)}
    >
      <Icon name={props.columns === 1 ? "list" : "columns"} size={13} />
    </button>
  );
}

/** Compact idea row: title with the first note line, folder, date. */
function IdeaRow(props: { idea: Idea }) {
  const title = () => props.idea.title || t("common.untitled");
  const note = () => firstLine(props.idea.notes);
  return (
    <div
      class="lrow is-idea"
      role="button"
      tabIndex={0}
      aria-label={title()}
      onClick={() => openIdea(props.idea)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openIdea(props.idea);
        }
      }}
    >
      <div class="lrow-t">
        <span class="lrow-title">{title()}</span>
        <Show when={note()}>
          <small>{note()}</small>
        </Show>
      </div>
      <div class="lrow-f">{library.folder(props.idea.folder_id)?.name ?? ""}</div>
      <div class="lrow-u">{relativeTime(props.idea.created_at)}</div>
      <div class="lrow-act">
        <button
          type="button"
          class="lrow-act-btn"
          title={t("shell.row.open", { hotkey: K("Enter") })}
          aria-label={t("shell.inbox.openIdea")}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            openIdea(props.idea);
          }}
        >
          <Icon name="return" size={13} />
        </button>
      </div>
    </div>
  );
}
