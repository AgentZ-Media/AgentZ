// Closing entries of the sidebar's "Open" list. Closing the script that is
// on screen moves to its neighbour in the list (below, else above) or, when
// nothing is left, to "Alle Skripte". The entry only disappears once the
// navigation went through, so a blocked save never loses the open script.

import { navStore } from "../../stores/nav";
import { openStore } from "../../stores/open";
import { library } from "./libraryData";

async function leaveIfShown(id: string, keep: string | null): Promise<boolean> {
  if (navStore.activeScriptId() !== id) return true;
  const list = openStore.ids().filter((x) => x === keep || x !== id);
  const index = openStore.ids().indexOf(id);
  const candidates = keep !== null ? [keep] : [...list.slice(index), ...list.slice(0, index).reverse()];
  const next = candidates.find((x) => x !== id && library.script(x));
  if (next) await navStore.openScript(next, library.script(next)?.title);
  else await navStore.openScripts();
  return navStore.activeScriptId() !== id;
}

export async function closeOpenScript(id: string): Promise<void> {
  if (await leaveIfShown(id, null)) openStore.remove(id);
}

/** Closes every entry except `keep`; `null` closes all of them. */
export async function closeOtherOpenScripts(keep: string | null): Promise<void> {
  const shown = navStore.activeScriptId();
  if (shown && shown !== keep && openStore.has(shown)) {
    if (!(await leaveIfShown(shown, keep))) return;
  }
  openStore.removeAllExcept(keep);
}
