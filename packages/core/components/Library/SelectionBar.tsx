import { Show } from "solid-js";
import { Icon } from "../Common/Icon";
import { t } from "../../i18n";

export interface SelectionBarProps {
  count: number;
  onSelectAll: () => void;
  onClear: () => void;
  onExit: () => void;
  onExportPdf: () => void;
  /** Omitted without a Studio connection - no Studio surface then. */
  onSend?: () => void;
  /** The two pickers open a menu anchored at the clicked button. */
  onMove: (anchor: HTMLElement) => void;
  onStage: (anchor: HTMLElement) => void;
  onTrash: () => void;
}

/** Floating action bar at the bottom of the scripts page while the
 *  selection mode is on (multi PDF, Studio, move, stage, trash). */
export function SelectionBar(props: SelectionBarProps) {
  const none = () => props.count === 0;
  return (
    <div class="lib-selbar" role="toolbar" aria-label={t("shell.select.aria")}>
      <span class="lib-selbar-count num">{t("select.count", { count: props.count })}</span>
      <button type="button" class="btn ghost sm" onClick={props.onSelectAll}>
        {t("select.selectAll")}
      </button>
      <button type="button" class="btn ghost sm" onClick={props.onClear} disabled={none()}>
        {t("select.clear")}
      </button>
      <span class="lib-selbar-div" aria-hidden="true" />
      <button type="button" class="btn sm" onClick={props.onExportPdf} disabled={none()}>
        <Icon name="export" />
        {t("select.action.pdf")}
      </button>
      <Show when={props.onSend}>
        <button type="button" class="btn sm" onClick={() => props.onSend?.()} disabled={none()}>
          <Icon name="cloud" />
          {t("select.action.send")}
        </button>
      </Show>
      <button
        type="button"
        class="btn sm"
        disabled={none()}
        onClick={(e) => props.onMove(e.currentTarget)}
      >
        <Icon name="folder" />
        {t("shell.select.move")}
      </button>
      <button
        type="button"
        class="btn sm"
        disabled={none()}
        onClick={(e) => props.onStage(e.currentTarget)}
      >
        {t("shell.select.stage")}
        <Icon name="up" />
      </button>
      <button type="button" class="btn danger sm" onClick={props.onTrash} disabled={none()}>
        <Icon name="trash" />
        {t("shell.select.trash")}
      </button>
      <span class="lib-selbar-div" aria-hidden="true" />
      <button type="button" class="btn primary sm" onClick={props.onExit}>
        {t("select.exit")}
      </button>
    </div>
  );
}
