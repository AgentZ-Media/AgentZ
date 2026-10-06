// Reactive multi-selection shared by the list pages (scripts overview and
// ideas page): the selection mode, the checked ids, the tri-state of the
// "select all" line and of group checkboxes, and the ⌘A key test. Each page
// keeps its own cursor / range anchor and decides what entering and leaving
// the mode means for it.

import { createSignal, type Accessor, type Setter } from "solid-js";
import { isModKey } from "@agentz/kit/platform";
import { checkState, toggleIds, withIds, type CheckState } from "./selection";

export interface ListSelectionOptions {
  /** What "select all" covers. Read lazily, so it may be declared after
   *  the selection. */
  selectableIds: Accessor<readonly string[]>;
}

export interface ListSelection {
  selectMode: Accessor<boolean>;
  setSelectMode: Setter<boolean>;
  selected: Accessor<Set<string>>;
  setSelected: Setter<Set<string>>;
  /** Tri-state of the "select all" checkbox. */
  allState: () => CheckState;
  /** Tri-state of a group checkbox covering `ids`. */
  groupState: (ids: readonly string[]) => CheckState;
  /** Turns the selection mode on with exactly `initial` checked. */
  enter: (initial?: Iterable<string>) => void;
  /** Turns the selection mode off and unchecks everything. */
  exit: () => void;
  /** Turns the selection mode on with every selectable id checked. */
  selectAll: () => void;
  /** Unchecks everything when all is checked, otherwise selects all. */
  toggleAll: () => void;
  /** Unchecks everything (the mode stays on). */
  clear: () => void;
  /** A fully checked batch is unchecked, anything else checked as a whole. */
  toggle: (ids: readonly string[]) => void;
  /** Checks all `ids` (shift-click ranges). */
  add: (ids: readonly string[]) => void;
  /** Drops checked ids that fail `keep`; no update when nothing drops. */
  retain: (keep: (id: string) => boolean) => void;
}

export function createListSelection(options: ListSelectionOptions): ListSelection {
  const [selectMode, setSelectMode] = createSignal(false);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());

  const allState = () => checkState(options.selectableIds(), selected());
  const groupState = (ids: readonly string[]) => checkState(ids, selected());
  const enter = (initial: Iterable<string> = []) => {
    setSelectMode(true);
    setSelected(new Set(initial));
  };
  const clear = () => setSelected(new Set<string>());
  const exit = () => {
    setSelectMode(false);
    clear();
  };
  const selectAll = () => enter(options.selectableIds());
  const toggleAll = () => (allState() === "all" ? clear() : selectAll());
  const toggle = (ids: readonly string[]) => setSelected((prev) => toggleIds(prev, ids));
  const add = (ids: readonly string[]) => setSelected((prev) => withIds(prev, ids, true));
  const retain = (keep: (id: string) => boolean) => {
    const cur = selected();
    if ([...cur].some((id) => !keep(id))) setSelected(new Set([...cur].filter(keep)));
  };

  return {
    selectMode,
    setSelectMode,
    selected,
    setSelected,
    allState,
    groupState,
    enter,
    exit,
    selectAll,
    toggleAll,
    clear,
    toggle,
    add,
    retain,
  };
}

/** ⌘A / Ctrl+A without Shift or Alt: "select all" on a list page. */
export function isSelectAllKey(e: KeyboardEvent): boolean {
  return isModKey(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a";
}
