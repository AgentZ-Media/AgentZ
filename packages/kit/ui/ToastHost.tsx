import { For, Show } from "solid-js";
import { runToastAction, toastsSignal } from "../stores";

export function ToastHost() {
  return (
    <div class="toast-host">
      <For each={toastsSignal()}>
        {(t) => (
          <div class={"toast " + t.kind} role="status">
            <span>{t.text}</span>
            <Show when={t.action}>
              {(action) => (
                <button type="button" class="undo" onClick={() => runToastAction(t.id)}>
                  {action().label}
                </button>
              )}
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
