import { createSignal } from "solid-js";
import { navStore } from "./nav";
import { settingsStore } from "./settings";

/**
 * Side panel of the list pages: a script opened next to the list or board
 * instead of replacing it. Session state only. The panel shows a full
 * editor; "expand" turns it into the normal script view (and adds it to
 * the sidebar's "Open" list), a panel alone never does.
 */
const [scriptId, setScriptId] = createSignal<string | null>(null);

export const peekStore = {
  scriptId,
  open: (id: string) => setScriptId(id),
  close: () => setScriptId(null),
  /** Opens `id` in the full script view; the panel closes with the list. */
  expand(id: string, title?: string): Promise<void> {
    return navStore.openScript(id, title);
  },
};

/** Opens a script the way the settings say: in the side panel or in the
 *  full view. `inverse` (Alt-click) does the other one. */
export function openScriptFromList(id: string, title?: string, inverse = false): void {
  const panel = settingsStore.openInPanel() !== inverse;
  if (panel) peekStore.open(id);
  else void navStore.openScript(id, title);
}

/** The script the global editor shortcuts (stage, export, timeline) act
 *  on: the one in the script view, else the one in the side panel. */
export function currentScriptId(): string | null {
  return navStore.activeScriptId() ?? scriptId();
}
