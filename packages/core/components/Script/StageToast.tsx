import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { StageGlyph } from "../Common/StageGlyph";
import { isModKey, K } from "../../lib/keys";
import { t } from "../../i18n";
import {
  isPrimaryStageToastHost,
  registerStageToastHost,
  stageLabel,
  stageUndo,
  undoStageChange,
} from "./stageActions";

/**
 * Undo toast for stage changes ("Auf „Drehbereit" gesetzt · Rückgängig ⌘Z").
 *
 * ⌘Z reverts the stage change instead of the last text edit - but only
 * right after the change: as soon as any other key is pressed the toast
 * stops claiming ⌘Z, so it can never swallow a text undo the writer meant.
 */
export function StageUndoToast() {
  const [hostId, setHostId] = createSignal(0);
  onMount(() => {
    const host = registerStageToastHost();
    setHostId(host.id);
    onCleanup(host.unregister);
  });
  const primary = () => hostId() > 0 && isPrimaryStageToastHost(hostId());

  createEffect(() => {
    const st = stageUndo();
    if (!st || !primary()) return;
    let armed = true;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Meta" || ev.key === "Control" || ev.key === "Shift" || ev.key === "Alt") return;
      const isUndo = isModKey(ev) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "z";
      if (armed && isUndo) {
        ev.preventDefault();
        ev.stopPropagation();
        void undoStageChange();
        return;
      }
      armed = false;
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });

  return (
    <Portal>
      <Show when={primary() && stageUndo()} keyed>
        {(st) => (
          <div class="ss-undo-host" role="status" aria-live="polite">
            <div class="toast">
              <StageGlyph stage={st.status} />
              <span>{t("script.stage.toast", { stage: stageLabel(st.status) })}</span>
              <button type="button" class="undo" onClick={() => void undoStageChange()}>
                {t("script.stage.undo")}
                <kbd>{K("Mod+Z")}</kbd>
              </button>
            </div>
          </div>
        )}
      </Show>
    </Portal>
  );
}

export default StageUndoToast;
