import { Match, Show, Switch } from "solid-js";
import { Icon } from "@agentz/kit/ui";
import type { Idea, ScriptSummary } from "../../../lib/types";
import { navStore } from "../../../stores/nav";
import { agentSettings } from "../../../stores/agentSettings";
import { t } from "../../../i18n";
import { StageGlyph } from "../../Common/StageGlyph";
import { folderColor } from "../../Common/folderColor";
import { AgentAvatar } from "../../Agent/AgentAvatar";
import { ideaAge } from "../ideaGroups";

export interface IdeaRowProps {
  idea: Idea;
  selected: boolean;
  /** Keyboard cursor / the row that opens in place. */
  primary: boolean;
  selectMode: boolean;
  /** Live scripts by id (link of a converted idea). */
  scripts: ReadonlyMap<string, ScriptSummary>;
  folderName: (id: string) => string;
  now: number;
  onClick: (e: MouseEvent) => void;
}

/** A collapsed list row; a click opens it in place (in the selection
 *  mode it toggles its checkbox instead). */
export function IdeaRow(props: IdeaRowProps) {
  return (
    <div
      id={`idea-row-${props.idea.id}`}
      class="irow"
      classList={{
        "is-sel": props.selected,
        "is-primary": props.primary,
        "is-used": !!props.idea.used_at,
      }}
      role="option"
      aria-selected={props.selected}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => props.onClick(e)}
    >
      <Switch>
        <Match when={props.selectMode}>
          <span class="selchk-box" classList={{ "is-on": props.selected }} aria-hidden="true">
            <Show when={props.selected}>
              <Icon name="check" size={11} />
            </Show>
          </span>
        </Match>
        <Match when={props.idea.used_at}>
          <Icon name="check" size={14} />
        </Match>
        <Match when={true}>
          <StageGlyph stage="idea" />
        </Match>
      </Switch>
      <div class="ti">
        <Show when={props.idea.source_chat_id}>
          <span class="i-by-agent" title={t("agentMode.ideas.byAgent", { name: agentSettings.displayName() })}>
            <AgentAvatar look={agentSettings.look()} size={14} state="still" />
          </span>
        </Show>
        {props.idea.title}
      </div>
      <div class="nt">
        <Show when={props.idea.used_at} fallback={props.idea.notes.split("\n")[0]}>
          <Show
            when={props.idea.script_id ? props.scripts.get(props.idea.script_id) : undefined}
            fallback={<span class="stale">{t("ideas.card.linked.stale")}</span>}
          >
            {(s) => (
              <button
                type="button"
                class="ilink"
                title={t("ideas.card.linked.title")}
                onClick={(e) => {
                  e.stopPropagation();
                  navStore.openScript(s().id, s().title);
                }}
              >
                <Icon name="doc" size={12} />
                {s().title || t("common.untitled")}
              </button>
            )}
          </Show>
        </Show>
      </div>
      <div class="fo">
        <Show when={props.idea.folder_id}>
          {(fid) => (
            <>
              <i style={{ background: folderColor(fid()) }} />
              <span>{props.folderName(fid())}</span>
            </>
          )}
        </Show>
      </div>
      <div class="ag">{ideaAge(props.idea.created_at, props.now)}</div>
      <span class="irow-chev" aria-hidden="true">
        <Icon name="down" size={13} />
      </span>
    </div>
  );
}
