import { createSignal } from "solid-js";

/** Optional button inside a toast, e.g. "Rückgängig". Running it closes
 *  the toast. */
export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "ok" | "error";
  action?: ToastAction;
}

const [toasts, setToasts] = createSignal<Toast[]>([]);
let next = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Toasts with an action stay this long by default, so there is time to
 *  reach the button. */
export const ACTION_TOAST_TIMEOUT = 6000;

export function pushToast(
  text: string,
  kind: Toast["kind"] = "info",
  timeout?: number,
  options: { action?: ToastAction } = {},
): number {
  const id = next++;
  const toast: Toast = options.action ? { id, text, kind, action: options.action } : { id, text, kind };
  setToasts([...toasts(), toast]);
  const ms = timeout ?? (options.action ? ACTION_TOAST_TIMEOUT : 2400);
  if (ms > 0) timers.set(id, setTimeout(() => dismissToast(id), ms));
  return id;
}

/** Runs the toast's action once and closes the toast. */
export function runToastAction(id: number): void {
  const toast = toasts().find((t) => t.id === id);
  dismissToast(id);
  if (!toast?.action) return;
  void Promise.resolve()
    .then(() => toast.action?.run())
    .catch((error: unknown) => console.warn("[kit] toast action failed", error));
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
