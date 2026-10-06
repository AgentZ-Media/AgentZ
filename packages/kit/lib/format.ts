// Locale-aware formatting. Reads the current language via i18n, so
// relative-time strings, month / weekday names, plurals
// and date layouts adapt automatically to the language setting. Re-evaluation
// in components happens because `t()` reactively reads the i18n language.

import { createSignal } from "solid-js";
import { formatDate, t } from "../i18n";

// Shared "current time" signal that ticks every 60s. Any reactive
// expression that calls `relativeTime()` automatically re-evaluates
// when the signal changes, so the "5 minutes ago" labels on the
// application views stay fresh without each component having
// to wire up its own interval. Reactivity flows through `relativeTime()`
// reading the signal below; `clockNow()` exposes it for other
// time-dependent labels (e.g. today's date).
const [nowSignal, setNowSignal] = createSignal(Date.now());

/** Current time in ms from the shared minute clock (reactive). */
export function clockNow(): number {
  return nowSignal();
}
let stopClock: (() => void) | undefined;

/** Start the visibility-gated clock for the active app runtime. */
export function startRelativeTimeClock(): () => void {
  if (stopClock) return stopClock;
  if (typeof window === "undefined") return () => {};
  setNowSignal(Date.now());
  // 60s cadence — good enough to keep "in 4 minutes" honest without
  // burning a render per second. Visibility-gated so background tabs
  // don't tick uselessly; refresh once on focus to catch up the long
  // tail (a tab returning from 20 minutes of background sleep).
  let timer: number | null = null;
  const start = () => {
    if (timer !== null) return;
    timer = window.setInterval(() => setNowSignal(Date.now()), 60_000);
  };
  const stop = () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      setNowSignal(Date.now());
      start();
    } else {
      stop();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (document.visibilityState === "visible") start();
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    stop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    stopClock = undefined;
  };
  stopClock = dispose;
  return dispose;
}

/** Locale-aware relative time. Format adapts to the active language.
 *  When called inside a reactive scope it re-evaluates every 60s
 *  via the shared `nowSignal` above. */
export function relativeTime(ms: number, now = nowSignal()): string {
  const diff = Math.max(0, now - ms);
  const sec = diff / 1000;
  if (sec < 30) return t("time.justNow");
  if (sec < 60) return t("time.secondsAgo", { n: Math.floor(sec) });
  const min = sec / 60;
  if (min < 60) return t("time.minutesAgo", { n: Math.floor(min) });
  const hr = min / 60;
  if (hr < 24) return t("time.hoursAgo", { n: Math.floor(hr) });
  const days = hr / 24;
  if (days < 2) return t("time.yesterday");
  if (days < 7) {
    const d = new Date(ms);
    return t(`weekday.${d.getDay()}` as
      | "weekday.0" | "weekday.1" | "weekday.2" | "weekday.3"
      | "weekday.4" | "weekday.5" | "weekday.6");
  }
  const date = new Date(ms);
  return formatDate(
    date,
    date.getFullYear() !== new Date(now).getFullYear()
      ? { day: "2-digit", month: "short", year: "numeric" }
      : { day: "2-digit", month: "short" },
  );
}

export function formatAbsolute(ms: number): string {
  return formatDate(ms, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function debounce<F extends (...args: any[]) => void>(fn: F, ms: number): F & { cancel(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: any[] | null = null;
  const debounced = ((...args: any[]) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = lastArgs!;
      lastArgs = null;
      fn(...a);
    }, ms);
  }) as F & { cancel(): void; flush(): void };
  (debounced as any).cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  (debounced as any).flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      const a = lastArgs!;
      lastArgs = null;
      fn(...a);
    }
  };
  return debounced;
}
