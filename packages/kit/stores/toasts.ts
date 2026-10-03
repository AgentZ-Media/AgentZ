import { createSignal } from "solid-js";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "ok" | "error";
}

const [toasts, setToasts] = createSignal<Toast[]>([]);
let next = 1;

export function pushToast(text: string, kind: Toast["kind"] = "info", timeout = 2400) {
  const id = next++;
  setToasts([...toasts(), { id, text, kind }]);
  if (timeout > 0) setTimeout(() => dismissToast(id), timeout);
}

export function dismissToast(id: number) {
  setToasts(toasts().filter((t) => t.id !== id));
}

export const toastsSignal = toasts;
