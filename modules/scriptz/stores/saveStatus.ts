// Global save-status indicator. The "Gespeichert" label in the script top bar reads
// this so the user always sees whether the editor's auto-save is
// healthy. Without a visible indicator a failing save would silently
// accumulate unsaved keystrokes.
//
// States:
//   - "idle"   : nothing pending, last save succeeded (or no save yet)
//   - "saving" : a save is in flight (short transient state)
//   - "error"  : the last save attempt threw — stays red until the
//                next successful save clears it

import { createSignal } from "solid-js";
import { pushToast } from "@agentz/kit/stores";
import { t } from "../i18n";

export type SaveStatus = "idle" | "saving" | "error";

const [status, setStatus] = createSignal<SaveStatus>("idle");
let toastedThisSession = false;

export const saveStatusStore = {
  status,
  startSaving() {
    setStatus("saving");
  },
  markSaved() {
    setStatus("idle");
  },
  markError(err: unknown) {
    setStatus("error");
    // One toast per session: a chronically broken save would otherwise
    // bury the user in identical popups every 250 ms. The persistent
    // red dot in the top bar keeps the situation visible.
    if (!toastedThisSession) {
      toastedThisSession = true;
      pushToast(
        t("save.error.toast", {
          message: (err as Error)?.message ?? String(err),
        }),
        "error",
      );
    }
  },
};
