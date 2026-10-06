// Page-level keyboard of the ideas page: ↑/↓ move, ⏎ opens, esc closes or
// leaves the selection, ⌘⏎ converts, ⌫ deletes, space checks, ⌘A selects
// all, "/" focuses the filter. The page registers the handler on the
// document for its lifetime.

import { isModKey } from "@agentz/kit/platform";
import type { Idea } from "../../lib/types";
import { uiStore } from "../../stores/ui";
import { isTypingTarget } from "../Common/keyboard";
import { isSelectAllKey } from "../Common/listSelection";

export interface IdeasKeyContext {
  /** A menu of the selection bar is open (it handles its own keys). */
  menuOpen: () => boolean;
  selectMode: () => boolean;
  /** Number of checked rows. */
  selectedCount: () => number;
  selectableCount: () => number;
  /** Keyboard cursor row. */
  primary: () => string | null;
  primaryIdea: () => Idea | null;
  /** The row shown expanded as an editor. */
  openId: () => string | null;
  selectedIdeas: () => Idea[];
  /** Submits the capture field (⌘⏎ while one of its buttons has focus). */
  capture: (startScript: boolean) => Promise<void>;
  convert: (idea: Idea) => Promise<void>;
  removeIdeas: (list: Idea[]) => Promise<void>;
  selectAll: () => void;
  toggleRow: (id: string) => void;
  focusFilter: () => void;
  move: (delta: number) => void;
  openRow: (id: string) => void;
  focusEditor: () => void;
  closeRow: () => void;
  exitSelectMode: () => void;
}

export function createIdeasKeyHandler(ctx: IdeasKeyContext): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.defaultPrevented || uiStore.anyDialogOpen() || ctx.menuOpen()) return;
    const target = e.target as HTMLElement | null;
    // Legacy modals (confirm) and open menus handle their own keys.
    if (target?.closest?.(".modal-backdrop, .scrim, .menu") || document.querySelector(".modal-backdrop")) return;
    const editable = isTypingTarget(target);
    const inEditor = !!target?.closest?.(".ix");

    if (e.key === "Enter" && isModKey(e)) {
      if (editable && !inEditor) return; // capture / filter fields handle it
      if (target?.closest?.(".i-cap")) {
        // A capture button (folder, similar link, ...) has focus.
        e.preventDefault();
        void ctx.capture(true);
        return;
      }
      const idea = ctx.primaryIdea();
      if (idea) {
        e.preventDefault();
        void ctx.convert(idea);
      }
      return;
    }
    if (editable) return;
    if (isSelectAllKey(e)) {
      if (target instanceof HTMLButtonElement && target.closest(".ix")) return;
      if (ctx.selectableCount() > 0) {
        e.preventDefault();
        ctx.selectAll();
      }
      return;
    }
    if (e.key === " " && ctx.selectMode() && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
      const id = ctx.primary();
      if (id) {
        e.preventDefault();
        ctx.toggleRow(id);
      }
      return;
    }
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      ctx.focusFilter();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (target instanceof HTMLButtonElement && target.closest(".ix, .i-cap, .i-chips")) return;
      e.preventDefault();
      ctx.move(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
      const idea = ctx.primaryIdea();
      if (idea && !ctx.selectMode() && ctx.selectedCount() === 1) {
        e.preventDefault();
        if (ctx.openId() === idea.id) ctx.focusEditor();
        else ctx.openRow(idea.id);
      }
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && !e.metaKey && !e.ctrlKey) {
      if (target instanceof HTMLButtonElement && (!target.closest(".ilist") || target.closest(".ix"))) return;
      const list = ctx.selectMode() ? ctx.selectedIdeas() : ctx.primaryIdea() ? [ctx.primaryIdea()!] : [];
      if (list.length > 0) {
        e.preventDefault();
        void ctx.removeIdeas(list);
      }
      return;
    }
    if (e.key === "Escape") {
      if (ctx.openId()) {
        e.preventDefault();
        ctx.closeRow();
      } else if (ctx.selectMode()) {
        e.preventDefault();
        ctx.exitSelectMode();
      }
    }
  };
}
