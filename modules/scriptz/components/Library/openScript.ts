// Opening a script from the scripts page: full view or side panel.

import { navStore } from "../../stores/nav";
import { openScriptFromList } from "../../stores/peek";
import { settingsStore } from "../../stores/settings";

/** Full script view; its paper fades in on its own (ScriptScreen.css). */
export function openFull(id: string, title?: string): void {
  void navStore.openScript(id, title);
}

/** Click in a list: side panel or full view, as the setting says. */
export function openFromList(id: string, title: string | undefined, inverse: boolean): void {
  if (settingsStore.openInPanel() !== inverse) openScriptFromList(id, title, inverse);
  else openFull(id, title);
}
