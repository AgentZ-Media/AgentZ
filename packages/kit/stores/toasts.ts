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

/** Toasts on screen at most; the oldest makes room. A failing operation
 *  repeated in a loop must not pile up notifications. */
const MAX_TOASTS = 4;

export function pushToast(
  text: string,
  kind: Toast["kind"] = "info",
  timeout?: number,
  options: { action?: ToastAction } = {},
): number {
  const ms = timeout ?? (options.action ? ACTION_TOAST_TIMEOUT : 2400);
  // The same plain message again only extends the one already shown.
  const same = options.action ? undefined : toasts().find((t) => !t.action && t.text === text && t.kind === kind);
  if (same) {
    clearTimeout(timers.get(same.id));
    timers.delete(same.id);
    if (ms > 0) timers.set(same.id, setTimeout(() => dismissToast(same.id), ms));
    return same.id;
  }
  const id = next++;
  const toast: Toast = options.action ? { id, text, kind, action: options.action } : { id, text, kind };
  const list = [...toasts(), toast];
  for (const old of list.splice(0, Math.max(0, list.length - MAX_TOASTS))) {
    clearTimeout(timers.get(old.id));
    timers.delete(old.id);
  }
  setToasts(list);
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
