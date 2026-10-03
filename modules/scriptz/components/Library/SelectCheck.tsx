import { Match, Switch, type JSX } from "solid-js";
import { Icon } from "@agentz/kit/ui";
import { t } from "../../i18n";
import type { CheckState } from "./selection";
import "./SelectionBar.css";

export interface SelectCheckProps {
  state: CheckState;
  /** Accessible name ("Alle auswählen", "Alle in „Schreiben“ auswählen"). */
  label: string;
  onToggle: () => void;
  /** Optional visible text right of the box. */
  children?: JSX.Element;
  class?: string;
}

/** Tri-state checkbox for group headers and the "select all" line of the
 *  list pages. Stops the click so a surrounding toggle doesn't fire. */
export function SelectCheck(props: SelectCheckProps) {
  return (
    <button
      type="button"
      role="checkbox"
      class={`selchk${props.class ? ` ${props.class}` : ""}`}
      aria-checked={props.state === "all" ? "true" : props.state === "some" ? "mixed" : "false"}
      aria-label={props.label}
      title={props.label}
      onClick={(e) => {
        e.stopPropagation();
        props.onToggle();
      }}
    >
      <span class="selchk-box" classList={{ "is-on": props.state !== "none" }} aria-hidden="true">
        <Switch>
          <Match when={props.state === "all"}>
            <Icon name="check" size={11} />
          </Match>
          <Match when={props.state === "some"}>
            <span class="selchk-dash" />
          </Match>
        </Switch>
      </span>
      {props.children}
    </button>
  );
}

export interface SelectAllLineProps {
  state: CheckState;
  /** Number of rows the checkbox covers. */
  count: number;
  onToggle: () => void;
}

/** "Alle auswählen" line above a list while the selection mode is on. */
export function SelectAllLine(props: SelectAllLineProps) {
  return (
    <div class="selhead">
      <SelectCheck state={props.state} label={t("select.all")} onToggle={props.onToggle}>
        {t("select.all")}
      </SelectCheck>
      <span class="n num">{props.count}</span>
    </div>
  );
}
