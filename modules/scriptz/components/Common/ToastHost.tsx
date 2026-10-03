import { For } from "solid-js";
import { toastsSignal } from "../../stores/toasts";

export function ToastHost() {
  return (
    <div class="toast-host">
      <For each={toastsSignal()}>
        {(t) => <div class={"toast " + t.kind}>{t.text}</div>}
      </For>
    </div>
  );
}

export default ToastHost;
