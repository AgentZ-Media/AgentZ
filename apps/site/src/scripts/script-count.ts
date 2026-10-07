// The public script counter: fetches the hourly sum from /api/stats.json (a
// Vercel rewrite to the backend whose CDN keeps the answer for an hour, see
// vercel.json) and counts up to it when the counter scrolls into view.
import { MIN_SCRIPTS } from "../stats";

const counters = [...document.querySelectorAll<HTMLElement>("[data-script-count]")];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const format = new Intl.NumberFormat(document.documentElement.lang || undefined);

async function fetchCount(): Promise<number | null> {
  try {
    const response = await fetch("/api/stats.json");
    if (!response.ok) return null;
    const body = await response.json() as { apps?: { scriptz?: { scripts?: unknown } } };
    const scripts = body.apps?.scriptz?.scripts;
    return typeof scripts === "number" && scripts >= MIN_SCRIPTS ? scripts : null;
  } catch {
    return null;
  }
}

function countUp(number: HTMLElement, value: number) {
  const start = performance.now();
  const duration = Math.min(2200, 900 + Math.log10(value + 1) * 300);
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / duration);
    number.textContent = format.format(Math.round(value * (1 - (1 - p) ** 4)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function show(counter: HTMLElement, value: number) {
  const number = counter.querySelector<HTMLElement>("[data-count-value]");
  const label = counter.querySelector<HTMLElement>("[data-count-label]");
  if (!number || !label) return;
  label.textContent = (value === 1 ? label.dataset.one : label.dataset.other) ?? "";
  counter.dataset.value = String(value);
  counter.hidden = false;
  const r = counter.getBoundingClientRect();
  if (reducedMotion || (r.top < window.innerHeight && r.bottom > 0)) {
    number.textContent = format.format(value);
    return;
  }
  // Below the fold: start at zero and count up once it is seen.
  number.textContent = format.format(0);
  const seen = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    seen.disconnect();
    countUp(number, value);
  }, { threshold: 0.6 });
  seen.observe(counter);
}

if (counters.length > 0) {
  void fetchCount().then((value) => {
    if (value) for (const counter of counters) show(counter, value);
  });
}
