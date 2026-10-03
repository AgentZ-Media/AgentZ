import { Show } from "solid-js";
import { Icon } from "../Common/Icon";
import { t } from "../../i18n";
import "./SelectionBar.css";

export interface SelectionBarProps {
  count: number;
  /** Every selectable row is selected: "Alle" is disabled then. */
  allSelected?: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onExit: () => void;
  /** Omitted where there is nothing to export (ideas). */
  onExportPdf?: () => void;
  /** Omitted without a Studio connection - no Studio surface then. */
  onSend?: () => void;
  /** The two pickers open a menu anchored at the clicked button. */
  onMove: (anchor: HTMLElement) => void;
  onStage: (anchor: HTMLElement) => void;
  /** Label of the stage picker (ideas: "Zu Skripten"). */
  stageLabel?: string;
  /** Disables only the stage picker (e.g. only converted ideas selected). */
  stageDisabled?: boolean;
  onTrash: () => void;
  /** Label of the destructive action (ideas are deleted, not trashed). */
  trashLabel?: string;
}

/** Floating action bar at the bottom of the list pages while the selection
 *  mode is on (scripts: PDF, Studio, move, stage, trash; ideas: Studio,
 *  move, convert into scripts, delete). */
export function SelectionBar(props: SelectionBarProps) {
  const none = () => props.count === 0;
  return (
    <div class="lib-selbar" role="toolbar" aria-label={t("shell.select.aria")}>
      <span class="lib-selbar-count num" aria-live="polite">
        {t("select.count", { count: props.count })}
      </span>
      <button type="button" class="btn ghost sm" onClick={props.onSelectAll} disabled={props.allSelected}>
        {t("select.selectAll")}
      </button>
      <button type="button" class="btn ghost sm" onClick={props.onClear} disabled={none()}>
        {t("select.clear")}
      </button>
      <span class="lib-selbar-div" aria-hidden="true" />
      <Show when={props.onExportPdf}>
        <button type="button" class="btn sm" onClick={() => props.onExportPdf?.()} disabled={none()}>
          <Icon name="export" />
          {t("select.action.pdf")}
        </button>
      </Show>
      <Show when={props.onSend}>
        <button type="button" class="btn sm" onClick={() => props.onSend?.()} disabled={none()}>
          <Icon name="cloud" />
          {t("select.action.send")}
        </button>
      </Show>
      <button
        type="button"
        class="btn sm"
        aria-haspopup="menu"
        disabled={none()}
        onClick={(e) => props.onMove(e.currentTarget)}
      >
        <Icon name="folder" />
        {t("shell.select.move")}
      </button>
      <button
        type="button"
        class="btn sm"
        aria-haspopup="menu"
        disabled={none() || props.stageDisabled}
        onClick={(e) => props.onStage(e.currentTarget)}
      >
        {props.stageLabel ?? t("shell.select.stage")}
        <Icon name="up" />
      </button>
      <button type="button" class="btn danger sm" onClick={props.onTrash} disabled={none()}>
        <Icon name="trash" />
        {props.trashLabel ?? t("shell.select.trash")}
      </button>
      <span class="lib-selbar-div" aria-hidden="true" />
      <button type="button" class="btn primary sm" onClick={props.onExit}>
        {t("select.exit")}
      </button>
    </div>
  );
}
