import { Show } from "solid-js";
import { Icon } from "@agentz/kit/ui";
import { INBOX_FOLDER_ID } from "../../../lib/folders";
import type { Folder } from "../../../lib/types";
import { agentSettings } from "../../../stores/agentSettings";
import { t } from "../../../i18n";
import { AgentAvatar } from "../../Agent/AgentAvatar";
import { agentModeAvailable, findIdeasWithAgent } from "../../AgentMode/actions";
import { FolderChips, type FolderChipCounts } from "../../Common/FolderChips";
import type { IdeaSort } from "../ideaGroups";
import { SortMenu } from "./SortMenu";

export interface IdeasToolbarProps {
  folders: Folder[];
  /** Ideas in the current scope per folder. */
  counts: FolderChipCounts;
  activeFolder: string | null;
  onFolder: (id: string | null) => void;
  filterRef: (el: HTMLInputElement) => void;
  query: string;
  onQuery: (value: string) => void;
  /** ↓ / ⏎ in the filter: hand the keyboard to the list (↓ also selects). */
  onFilterLeave: (selectFirst: boolean) => void;
  sort: IdeaSort;
  onSort: (sort: IdeaSort) => void;
  showUsed: boolean;
  onShowUsed: (on: boolean) => void;
  selectMode: boolean;
  /** The list is empty: the selection mode cannot start. */
  selectDisabled: boolean;
  onToggleSelect: () => void;
}

/** Folder chips, "find ideas with the agent", text filter, sorting,
 *  "show converted" and the selection mode switch. */
export function IdeasToolbar(props: IdeasToolbarProps) {
  const sortOptions = () => [
    { id: "newest" as IdeaSort, label: t("ideasPage.sort.newest") },
    { id: "oldest" as IdeaSort, label: t("ideasPage.sort.oldest") },
    { id: "title" as IdeaSort, label: t("ideasPage.sort.title") },
  ];

  return (
    <div class="i-chips" role="group" aria-label={t("folder.chips.aria")}>
      <FolderChips
        folders={props.folders}
        counts={props.counts}
        active={props.activeFolder}
        onSelect={props.onFolder}
      />
      <Show when={agentModeAvailable()}>
        <button
          type="button"
          class="fchip i-agent"
          title={t("agentMode.ideas.findTitle", { name: agentSettings.displayName() })}
          onClick={() => void findIdeasWithAgent(props.activeFolder === INBOX_FOLDER_ID ? null : props.activeFolder)}
        >
          <AgentAvatar look={agentSettings.look()} size={16} state="idle" />
          {t("agentMode.ideas.find", { name: agentSettings.displayName() })}
        </button>
      </Show>
      <span class="sp" />
      <label class="field-box i-filter">
        <Icon name="search" size={13} />
        <input
          ref={(el) => props.filterRef(el)}
          value={props.query}
          placeholder={t("ideasPage.filter.placeholder")}
          aria-label={t("ideasPage.filter.placeholder")}
          spellcheck={false}
          onInput={(e) => props.onQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              if (props.query) props.onQuery("");
              else e.currentTarget.blur();
            } else if (e.key === "ArrowDown" || e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
              props.onFilterLeave(e.key === "ArrowDown");
            }
          }}
        />
        <Show when={props.query} fallback={<kbd>/</kbd>}>
          <button
            type="button"
            class="i-filter-clear"
            aria-label={t("ideasPage.filter.clear")}
            title={t("ideasPage.filter.clear")}
            onClick={() => props.onQuery("")}
          >
            <Icon name="x" size={12} />
          </button>
        </Show>
      </label>
      <SortMenu options={sortOptions()} value={props.sort} onChange={props.onSort} ariaLabel={t("ideasPage.sort.aria")} />
      <button
        type="button"
        class="btn ghost ideas-used-tg"
        classList={{ "is-on": props.showUsed }}
        aria-pressed={props.showUsed}
        onClick={() => props.onShowUsed(!props.showUsed)}
      >
        <Show when={props.showUsed}>
          <Icon name="check" size={13} />
        </Show>
        {t("ideasPage.bar.showUsed")}
      </button>
      <button
        type="button"
        class="btn ghost"
        classList={{ "is-on": props.selectMode }}
        aria-pressed={props.selectMode}
        disabled={props.selectDisabled}
        onClick={() => props.onToggleSelect()}
      >
        <Icon name="select" />
        {t("select.enter")}
      </button>
    </div>
  );
}
