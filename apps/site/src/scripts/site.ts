// Progressive enhancement for the website: reveal-on-scroll, pausing of
// off-screen loops, the typing ScriptZ demo, the copy button and the
// download button for the visitor's platform. No network, no storage.
import type { DemoBlock } from "../i18n";
import { demoStats, formatTime } from "./demo-model";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- Reveal once, keep loops running only while visible ----
const reveal = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add("is-in");
    reveal.unobserve(entry.target);
  }
}, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
document.querySelectorAll("[data-reveal]").forEach((el) => reveal.observe(el));

const live = new IntersectionObserver((entries) => {
  for (const entry of entries) entry.target.classList.toggle("is-live", entry.isIntersecting);
}, { threshold: 0.05 });
document.querySelectorAll(".tile, .gallery, .site-footer").forEach((el) => live.observe(el));

// ---- Copy the install command ----
document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
  const label = button.textContent;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy ?? "");
      button.textContent = button.dataset.copied ?? label;
      window.setTimeout(() => { button.textContent = label; }, 1800);
    } catch {
      // Clipboard denied: the command stays selectable in the page.
    }
  });
});

// ---- Put the visitor's platform first ----
const buttons = document.querySelector<HTMLElement>("[data-os-buttons]");
if (buttons && /Windows/i.test(navigator.userAgent)) {
  const mac = buttons.querySelector<HTMLElement>('[data-os="mac"]');
  const win = buttons.querySelector<HTMLElement>('[data-os="win"]');
  if (mac && win) {
    mac.classList.remove("accent");
    win.classList.add("accent");
    buttons.prepend(win);
  }
}

// ---- The runtime tile counts up into its target range ----
const runtime = document.querySelector<HTMLElement>("[data-runtime]");
const runtimeCount = runtime?.querySelector<HTMLElement>("[data-runtime-count]");
if (runtime && runtimeCount && !reducedMotion) {
  const tile = runtime.closest<HTMLElement>(".tile");
  const target = 38;
  const countMs = 4200;
  const holdMs = 2600;
  let elapsed = 0;
  let last = 0;
  let shown = -1;
  const frame = (now: number) => {
    const running = !tile || tile.classList.contains("is-live");
    if (running && !document.hidden) elapsed = (elapsed + Math.min(now - (last || now), 100)) % (countMs + holdMs);
    last = now;
    const progress = Math.min(elapsed / countMs, 1);
    const seconds = Math.round(target * (1 - (1 - progress) ** 3));
    if (seconds !== shown) {
      shown = seconds;
      runtime.style.setProperty("--sec", String(seconds));
      runtimeCount.textContent = String(seconds).padStart(2, "0");
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---- The ScriptZ demo window types its sketch ----
const demo = document.querySelector<HTMLElement>("[data-demo]");
if (demo && !reducedMotion) runDemo(demo);

function runDemo(root: HTMLElement) {
  const script = JSON.parse(root.dataset.script ?? "[]") as DemoBlock[];
  const chips = JSON.parse(root.dataset.chips ?? "{}") as Record<string, string>;
  const pct = root.dataset.pct ?? "%";
  const desk = root.querySelector<HTMLElement>("[data-demo-desk]");
  const paper = root.querySelector<HTMLElement>("[data-demo-paper]");
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-demo-paper] .blk")];
  const castRows = [...root.querySelectorAll<HTMLElement>("[data-demo-cast] li")];
  const segments = root.querySelector<HTMLElement>("[data-demo-segments]");
  const set = (selector: string, value: string) => root.querySelectorAll(selector).forEach((el) => { el.textContent = value; });
  if (!desk || !paper || blocks.length !== script.length) return;

  let visible = false;
  let wake: (() => void) | null = null;
  new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
    if (visible && wake) { wake(); wake = null; }
  }, { threshold: 0.15 }).observe(root);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && wake) { wake(); wake = null; } });

  const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const ready = () => (visible && !document.hidden ? Promise.resolve() : new Promise<void>((resolve) => { wake = resolve; }));

  const caret = document.createElement("span");
  caret.className = "caret";

  function update(typed: DemoBlock[]) {
    const stats = demoStats(typed);
    set("[data-demo-time], [data-demo-time-small]", formatTime(stats.seconds));
    set("[data-demo-words]", String(stats.words));
    set("[data-demo-dialog]", String(stats.dialogWords));
    set("[data-demo-switches]", String(stats.switches));
    for (const row of castRows) {
      const entry = stats.cast.find((c) => c.name === row.dataset.name);
      row.hidden = !entry;
      const share = entry?.share ?? 0;
      const label = row.querySelector("em");
      const bar = row.querySelector<HTMLElement>(".aw-cast-bar i");
      if (label) label.textContent = `${share}${pct}`;
      if (bar) bar.style.width = `${share}%`;
    }
    if (segments) {
      const bars = stats.segments.map((s) => {
        const i = document.createElement("i");
        i.style.flexGrow = String(s.weight);
        i.style.setProperty("--seg", s.color ? `var(--char-${s.color})` : "var(--line-strong)");
        return i;
      });
      // Keep the bar shorter than full while the sketch is still growing.
      const rest = document.createElement("i");
      rest.style.flexGrow = String(Math.max(0, 140 - stats.words));
      rest.style.setProperty("--seg", "transparent");
      segments.replaceChildren(...bars, rest);
    }
  }

  function follow(el: HTMLElement) {
    const bottom = el.offsetTop + el.offsetHeight + 120;
    if (bottom > desk!.scrollTop + desk!.clientHeight) desk!.scrollTo({ top: bottom - desk!.clientHeight, behavior: "smooth" });
  }

  const speed = { a: 15, c: 60, d: 30, p: 48 } as const;

  async function loop() {
    for (;;) {
      await ready();
      paper!.style.opacity = "1";
      desk!.scrollTo({ top: 0 });
      blocks.forEach((el) => { el.hidden = true; el.textContent = ""; });
      const typed: DemoBlock[] = [];
      update(typed);
      await sleep(900);
      for (const [index, [kind, text]] of script.entries()) {
        const el = blocks[index]!;
        el.hidden = false;
        el.dataset.chip = chips[kind] ?? "";
        el.classList.add("is-active");
        typed.push([kind, ""]);
        for (let n = 1; n <= text.length; n++) {
          await ready();
          el.textContent = text.slice(0, n);
          el.append(caret);
          typed[typed.length - 1] = [kind, text.slice(0, n)];
          if (text[n - 1] === " " || n === text.length) update(typed);
          follow(el);
          await sleep(speed[kind] + Math.random() * speed[kind]);
        }
        await sleep(kind === "c" ? 220 : 520);
        el.classList.remove("is-active");
        caret.remove();
      }
      await sleep(5200);
      paper!.style.opacity = "0";
      await sleep(450);
    }
  }
  paper.style.transition = "opacity 400ms";
  void loop();
}
