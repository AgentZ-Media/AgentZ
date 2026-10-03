import { createSignal } from "solid-js";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "ok" | "error";
}

const [toasts, setToasts] = createSignal<Toast[]>([]);
let next = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function pushToast(text: string, kind: Toast["kind"] = "info", timeout = 2400) {
  const id = next++;
  setToasts([...toasts(), { id, text, kind }]);
  if (timeout > 0) timers.set(id, setTimeout(() => dismissToast(id), timeout));
}

export function dismissToast(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  setToasts(toasts().filter((t) => t.id !== id));
}

/** End transient notifications with the owning shell. */
export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  setToasts([]);
}

export const toastsSignal = toasts;
