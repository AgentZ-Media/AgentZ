// Progressive enhancement for every page: the dot grid behind the page,
// reveal-on-scroll, the copy button and the download button for the
// visitor's platform. No network, no storage.
import { startDotField } from "./dot-field";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- The plain dot grid (the home page drives its own field) ----
const canvas = document.querySelector<HTMLCanvasElement>("[data-field='plain']");
if (canvas) {
  document.documentElement.classList.add("has-field");
  startDotField(canvas, [], reducedMotion)?.loop();
}

// ---- Reveal once ----
const reveal = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add("is-in");
    reveal.unobserve(entry.target);
  }
}, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
document.querySelectorAll("[data-reveal]").forEach((el) => reveal.observe(el));

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
