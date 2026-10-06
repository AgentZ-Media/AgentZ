import { Show } from "solid-js";
import { INBOX_FOLDER_ID } from "../../../lib/folders";
import { agentSettings } from "../../../stores/agentSettings";
import { t } from "../../../i18n";
import { AgentAvatar } from "../../Agent/AgentAvatar";
import { agentModeAvailable, findIdeasWithAgent } from "../../AgentMode/actions";

export interface IdeasEmptyProps {
  /** No ideas at all (before any filter). */
  none: boolean;
  /** The text filter, trimmed; empty when not filtering. */
  query: string;
  filtering: boolean;
  activeFolder: string | null;
}

/** Empty list of the ideas page: nothing captured yet, nothing matching
 *  the filter, an empty folder or every idea already converted. */
export function IdeasEmpty(props: IdeasEmptyProps) {
  return (
    <div class="i-empty">
      <b>
        {props.none
          ? t("ideasPage.empty.none")
          : props.filtering
            ? t("ideasPage.empty.query", { query: props.query })
            : props.activeFolder !== null
              ? t("ideasPage.empty.folder")
              : t("ideasPage.empty.allUsed")}
      </b>
      <span>
        {props.none
          ? t("ideasPage.empty.noneSub")
          : props.filtering
            ? t("ideasPage.empty.querySub")
            : props.activeFolder !== null
              ? t("ideasPage.empty.folderSub")
              : t("ideasPage.empty.allUsedSub")}
      </span>
      <Show when={agentModeAvailable() && !props.filtering}>
        <button
          type="button"
          class="btn i-empty-agent"
          onClick={() => void findIdeasWithAgent(props.activeFolder === INBOX_FOLDER_ID ? null : props.activeFolder)}
        >
          <AgentAvatar look={agentSettings.look()} size={18} state="idle" />
          {t("agentMode.ideas.find", { name: agentSettings.displayName() })}
        </button>
      </Show>
    </div>
  );
}
