import { Show } from "solid-js";
import { Icon } from "@agentz/kit/ui";
import { navStore } from "../../stores/nav";
import { t } from "../../i18n";
import type { ContextMenuItem } from "../Common/ContextMenu";
import { importScriptzFile } from "./actions";
import { libraryPrefs, type Grouping, type ViewMode, type ViewScope } from "./prefs";

/** Where and how a menu of the tools row opens. */
export interface ToolsMenuOptions {
  align?: "start" | "end";
  placement?: "below" | "above";
  width?: number;
}

export interface ScriptsToolsProps {
  filterRef: (el: HTMLInputElement) => void;
  /** Filter text as typed (not debounced). */
  filter: string;
  onFilterInput: (value: string) => void;
  /** Empties the filter right away (no debounce). */
  onClearFilter: () => void;
  /** Scope of the list / board switch; null hides it. */
  viewScope: ViewScope | null;
  isBoard: boolean;
  onView: (scope: ViewScope, mode: ViewMode) => void;
  selectMode: boolean;
  selectDisabled: boolean;
  onToggleSelect: () => void;
  onMenu: (anchor: HTMLElement, items: ContextMenuItem[], opts?: ToolsMenuOptions) => void;
  onNewFolder: () => void;
}

const groupingLabel = (g: Grouping) =>
  g === "stage"
    ? t("shell.group.byStage")
    : g === "folder"
      ? t("shell.group.byFolder")
      : t("shell.group.none");

const groupingItems = (): ContextMenuItem[] =>
  (["stage", "folder", "none"] as const).map((g) => ({
    label: g === "stage" ? t("shell.group.stage") : g === "folder" ? t("shell.group.folder") : t("shell.group.off"),
    checked: libraryPrefs.grouping() === g,
    onClick: () => libraryPrefs.setGrouping(g),
  }));

const sortItems = (): ContextMenuItem[] =>
  (["updated", "created", "title"] as const).map((k) => ({
    label: t(`browser.sort.${k}`),
    checked: libraryPrefs.sort() === k,
    onClick: () => libraryPrefs.setSort(k),
  }));

function ViewButton(p: { mode: ViewMode; scope: ViewScope; onView: (scope: ViewScope, mode: ViewMode) => void }) {
  return (
    <button
      type="button"
      aria-pressed={libraryPrefs.viewMode(p.scope) === p.mode}
      onClick={() => p.onView(p.scope, p.mode)}
    >
      <Icon name={p.mode} size={13} />
      {p.mode === "list" ? t("shell.view.list") : t("shell.view.board")}
    </button>
  );
}

/** Tools row above the list: filter, list / board, grouping, sorting,
 *  selection mode and the "⋯" menu (import, new folder, trash). */
export function ScriptsTools(props: ScriptsToolsProps) {
  let filterRef: HTMLInputElement | undefined;

  const moreItems = (): ContextMenuItem[] => [
    { label: t("browser.import.title"), icon: "import", onClick: () => void importScriptzFile() },
    { label: t("browser.canvas.newFolder"), icon: "folder", onClick: () => props.onNewFolder() },
    {
      label: t("browser.trash"),
      icon: "trash",
      separatorBefore: true,
      onClick: () => navStore.go({ kind: "trash" }),
    },
  ];

  return (
    <div class="lib-tools">
      <label class="field-box lib-filter">
        <Icon name="search" size={13} />
        <input
          ref={(el) => {
            filterRef = el;
            props.filterRef(el);
          }}
          type="text"
          value={props.filter}
          placeholder={t("shell.filter.placeholder")}
          aria-label={t("shell.filter.placeholder")}
          spellcheck={false}
          onInput={(e) => props.onFilterInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              if (props.filter) {
                props.onClearFilter();
              } else {
                e.currentTarget.blur();
              }
            }
          }}
        />
        <Show when={props.filter} fallback={<kbd>/</kbd>}>
          <button
            type="button"
            class="lib-filter-x"
            aria-label={t("shell.filter.clear")}
            title={t("shell.filter.clear")}
            onClick={() => {
              props.onClearFilter();
              filterRef?.focus();
            }}
          >
            <Icon name="x" size={12} />
          </button>
        </Show>
      </label>
      <Show when={props.viewScope}>
        {(scope) => (
          <div class="lib-view" role="group" aria-label={t("shell.view.aria")}>
            <ViewButton mode="list" scope={scope()} onView={props.onView} />
            <ViewButton mode="board" scope={scope()} onView={props.onView} />
          </div>
        )}
      </Show>
      <Show when={!props.isBoard}>
        <button
          type="button"
          class="btn ghost"
          aria-haspopup="menu"
          onClick={(e) => props.onMenu(e.currentTarget, groupingItems(), { width: 200 })}
        >
          {groupingLabel(libraryPrefs.grouping())}
          <Icon name="down" size={12} />
        </button>
      </Show>
      <button
        type="button"
        class="btn ghost"
        aria-haspopup="menu"
        title={t("shell.sort.title")}
        onClick={(e) => props.onMenu(e.currentTarget, sortItems(), { width: 180 })}
      >
        {t(`browser.sort.${libraryPrefs.sort()}`)}
        <Icon name="down" size={12} />
      </button>
      <Show when={!props.isBoard}>
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
      </Show>
      <button
        type="button"
        class="btn ghost icon"
        aria-haspopup="menu"
        title={t("shell.more")}
        aria-label={t("shell.more")}
        onClick={(e) => props.onMenu(e.currentTarget, moreItems())}
      >
        <Icon name="dots" />
      </button>
    </div>
  );
}
