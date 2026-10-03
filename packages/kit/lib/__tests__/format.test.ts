import { afterEach, describe, expect, it, vi } from "vitest";
import { applyResolvedLanguage } from "../../i18n";
import { debounce, formatAbsolute, relativeTime, startRelativeTimeClock } from "../format";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("shared locale-aware formatting", () => {
  it("owns the visibility clock, including repeated start and disposal", () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const stop = startRelativeTimeClock();
    cleanups.push(stop);
    expect(startRelativeTimeClock()).toBe(stop);
    expect(vi.getTimerCount()).toBe(1);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(1);
    stop();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("formats relative time in the active language", () => {
    const now = new Date(2026, 9, 3, 12).getTime();
    applyResolvedLanguage("de");
    expect(relativeTime(now, now)).toBe("Gerade eben");
    expect(relativeTime(now - 120_000, now)).toBe("vor 2 Min.");
    applyResolvedLanguage("en");
    expect(relativeTime(now, now)).toBe("Just now");
    expect(relativeTime(now - 120_000, now)).toBe("2 min ago");
  });

  it("uses the active locale for absolute dates", () => {
    const date = new Date(2026, 9, 3, 12, 34);
    const options: Intl.DateTimeFormatOptions = {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    };
    for (const language of ["de", "en"] as const) {
      applyResolvedLanguage(language);
      expect(formatAbsolute(date.getTime())).toBe(date.toLocaleString(language === "de" ? "de-DE" : "en-US", options));
    }
  });

  it("coalesces a debounce and drains the latest arguments exactly once", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const pending = debounce(run, 100);
    pending("old");
    pending("new");
    pending.flush();
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("new");
    pending("cancelled");
    pending.cancel();
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
