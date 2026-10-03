// Global keyboard shortcuts of the Werkbank shell (docs/redesign/umsetzung.md
// §7). Registered once by AppShell on `window` in the bubble phase, so any
// focused component (editor plugins, dialogs, menus) can claim a key first
// with preventDefault / stopPropagation.
//
// Editor-local keys (⌘1-4, Tab picker, Smart-Enter, ⌘B/⌘U, ⌘⇧S/⌘⇧H
// snapshots) belong to the script screen and are not handled here.

import { isModKey } from "../../lib/keys";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { createScript } from "../Library/actions";
import { stepStage } from "../Script/stageActions";

/** True while any modal surface is open. Covers the ui-store dialogs and
 *  every other `aria-modal` dialog (rename prompts, confirms, snapshots,
 *  ...). Context menus close on their own keys. */
export function modalSurfaceOpen(): boolean {
  if (uiStore.anyDialogOpen()) return true;
  return typeof document !== "undefined" && document.querySelector('[aria-modal="true"]') !== null;
}

export function handleGlobalShortcut(ev: KeyboardEvent): void {
  if (ev.defaultPrevented || ev.isComposing) return;
  if (!isModKey(ev)) return;
  // Dialogs own the keyboard while open (they handle Esc themselves).
  if (modalSurfaceOpen()) return;

  const key = ev.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  const shift = ev.shiftKey;
  const alt = ev.altKey;
  const scriptId = navStore.activeScriptId();

  const take = (fn: () => void) => {
    ev.preventDefault();
    fn();
  };

  // ⌘K - search & commands
  if (lower === "k" && !shift && !alt) return take(() => uiStore.openPalette());
  // ⌘N - new script in the current folder context
  if (lower === "n" && !shift && !alt) return take(() => void createScript());
  // ⌘I - capture an idea, everywhere (also in focus mode; never italic)
  if (lower === "i" && !shift && !alt) return take(() => uiStore.openCapture());
  // ⌘, - settings
  if (key === "," && !shift && !alt) return take(() => uiStore.openSettings());

  // ⌘[ / ⌘] - history. Matched on the produced character, so layouts that
  // need ⌥ for brackets (German Mac: ⌘⌥5 / ⌘⌥6) work too.
  if (key === "[") return take(() => navStore.back());
  if (key === "]") return take(() => navStore.forward());

  // ⌘⇧\ - inspector (US layouts report "|" with shift held). Before ⌘\ so
  // the shifted variant never toggles the sidebar.
  if (key === "|" || (key === "\\" && shift)) {
    if (!scriptId) return;
    return take(() => uiStore.toggleInspector());
  }
  // ⌘\ - sidebar
  if (key === "\\") return take(() => uiStore.toggleSidebar());

  // ⌘⌥→ / ⌘⌥← - stage step on the open script
  if (alt && !shift && (key === "ArrowRight" || key === "ArrowLeft")) {
    if (!scriptId) return;
    return take(() => void stepStage(scriptId, key === "ArrowRight" ? 1 : -1));
  }

  if (alt) return;

  // ⌘J - timeline (script route)
  if (lower === "j" && !shift) {
    if (!scriptId) return;
    return take(() => uiStore.toggleTimeline());
  }
  // ⌘⇧F - focus mode (script route)
  if (lower === "f" && shift) {
    if (!scriptId) return;
    return take(() => uiStore.toggleFocus(scriptId));
  }
  // ⌘E - export the open script
  if (lower === "e" && !shift) {
    if (!scriptId) return;
    return take(() => uiStore.openExport(scriptId));
  }
}
