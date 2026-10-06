import { Icon } from "@agentz/kit/ui";
import type { Idea } from "../../../lib/types";
import type { ListSelection } from "../../Common/listSelection";
import { GroupCheck } from "../../Common/SelectCheck";
import type { IdeaGroup } from "../ideaGroups";

export interface IdeaGroupHeaderProps {
  selection: ListSelection;
  group: IdeaGroup<Idea>;
  /** Localised group name ("Heute", "Diese Woche", ...). */
  label: string;
  open: boolean;
  onToggle: () => void;
}

/** Time group header of the ideas list: group checkbox (selection mode)
 *  and the fold toggle with the count. */
export function IdeaGroupHeader(props: IdeaGroupHeaderProps) {
  return (
    <div class="igrp-h" classList={{ closed: !props.open }}>
      <GroupCheck selection={props.selection} ids={props.group.items.map((i) => i.id)} name={props.label} />
      <button type="button" class="igrp-tog" aria-expanded={props.open} onClick={() => props.onToggle()}>
        <Icon name={props.open ? "down" : "right"} size={11} />
        {props.label} <em>{props.group.items.length}</em>
      </button>
    </div>
  );
}
