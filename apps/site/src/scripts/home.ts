// Home page: the dot field with the suite Z in the hero (opening with the
// zoom-out intro) and the yellow dot that travels down the page.
import { LOGO_DOTS } from "@agentz/design/logo";
import { startDotField, type ScenePoint, type Tone } from "./dot-field";
import { startJourney } from "./dot-journey";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const visible = (el: Element, margin = 0) => {
  const r = el.getBoundingClientRect();
  return r.bottom > -margin && r.top < window.innerHeight + margin;
};

/** The suite Z; on large anchors every logo dot is a small cluster of dots. */
function logoPoints(w: number, h: number): ScenePoint[] {
  const s = Math.min(w / 50, h / 60);
  const x0 = (w - s * 50) / 2;
  const y0 = (h - s * 60) / 2;
  const R = 3.1 * s;
  const rings = R > 22 ? 2 : R > 12 ? 1 : 0;
  const gap = rings ? R / (rings + 0.45) : 0;
  const out: ScenePoint[] = [];
  for (const dot of LOGO_DOTS) {
    const cx = x0 + dot.cx * s, cy = y0 + dot.cy * s;
    const tone: Tone = dot.tone === "main" ? "fg" : "sub";
    if (!rings) { out.push({ x: cx, y: cy, r: R, tone }); continue; }
    out.push({ x: cx, y: cy, r: gap * 0.4, tone });
    for (let k = 1; k <= rings; k++) {
      for (let j = 0; j < 6 * k; j++) {
        const a = (j / (6 * k)) * Math.PI * 2 + (k % 2 ? 0 : Math.PI / 6);
        out.push({ x: cx + Math.cos(a) * gap * k, y: cy + Math.sin(a) * gap * k, r: gap * 0.4, tone });
      }
    }
  }
  return out;
}

const canvas = document.querySelector<HTMLCanvasElement>("[data-field='page']");
const logo = document.querySelector<HTMLElement>("[data-dot-scene='logo']");
const hero = document.querySelector<HTMLElement>("[data-hero]");
const dot = document.querySelector<HTMLElement>("[data-dot]");
if (!canvas) document.documentElement.classList.add("intro-done");
if (canvas) {
  document.documentElement.classList.add("has-field");
  const scenes = logo ? [{ el: logo, active: () => visible(logo, 80), points: logoPoints, version: () => 0, sweep: true }] : [];
  const field = startDotField(canvas, scenes, reducedMotion);
  field?.loop();
  // Opening a page in the middle (reload, anchor) skips the intro.
  const fresh = window.scrollY < 40 && !location.hash;
  const ready = () => document.documentElement.classList.add("intro-done");
  if (field && fresh) void field.intro(4600).then(ready); else ready();
  hero?.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a, button")) return;
    field?.burst(event.clientX, event.clientY);
  });
  // The travelling dot follows the scroll position, so reduced motion keeps
  // every waypoint's own static dot instead.
  if (dot && !reducedMotion) startJourney(dot, (x, y, r) => field?.light(x, y, r));
}
