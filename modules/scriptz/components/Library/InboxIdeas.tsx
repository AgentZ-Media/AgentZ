import { For, Show } from "solid-js";
import { relativeTime } from "@agentz/kit/lib";
import { K } from "@agentz/kit/platform";
import { Icon } from "@agentz/kit/ui";
import type { Idea } from "../../lib/types";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { t } from "../../i18n";
import { StageGlyph } from "../Common/StageGlyph";
import { library } from "../Shell/libraryData";

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

/** "Ideen" group of the inbox: every open idea as a list row, below the
 *  scripts that are still in progress. */
export function InboxIdeas(props: {
  ideas: Idea[];
  closed: boolean;
  canCollapse: boolean;
  onToggle: () => void;
}) {
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
        <button type="button" class="grp-act" onClick={() => void navStore.openIdeas()}>
          {t("shell.teaser.open")}
          <Icon name="right" size={12} />
        </button>
      </div>
      <Show when={!props.closed}>
        <div class="rows">
          <For each={props.ideas}>{(idea) => <IdeaRow idea={idea} />}</For>
        </div>
      </Show>
    </section>
  );
}

function IdeaRow(props: { idea: Idea }) {
  const title = () => props.idea.title || t("common.untitled");
  const note = () => firstLine(props.idea.notes);
  return (
    <div
      class="lrow"
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
      <span class="lrow-glyph">
        <StageGlyph stage="idea" />
      </span>
      {/* Ideas have no page preview; the empty cell keeps the grid columns
          aligned with the script rows. */}
      <span class="lrow-thumb-gap" aria-hidden="true" />
      <div class="lrow-t">
        <span class="lrow-title">{title()}</span>
        <Show when={note()}>
          <small>{note()}</small>
        </Show>
      </div>
      <div class="lrow-f">{library.folder(props.idea.folder_id)?.name ?? ""}</div>
      <div class="lrow-cast" />
      <div class="lrow-rt" />
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
