// ScriptZ page: scales the live rebuild to its stage and switches its
// areas with the step tabs.
import { initLive } from "./live";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const root = document.querySelector<HTMLElement>("[data-live]");
const stage = document.querySelector<HTMLElement>("[data-stage]");
const scaler = document.querySelector<HTMLElement>("[data-scaler]");
if (root && stage && scaler) {
  let scale = 1;
  const fit = () => {
    const compact = stage.clientWidth < 760;
    root.classList.toggle("is-compact", compact);
    const w = compact ? 520 : 1200;
    const h = compact ? 700 : 740;
    scale = Math.min(1, stage.clientWidth / w, stage.clientHeight / h);
    root.style.width = `${w}px`;
    root.style.height = `${h}px`;
    scaler.style.width = `${w * scale}px`;
    scaler.style.height = `${h * scale}px`;
    root.style.transform = `scale(${scale})`;
  };
  fit();
  new ResizeObserver(fit).observe(stage);

  const live = initLive(root, reducedMotion, () => scale);
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-steps] button")];
  const copies = [...document.querySelectorAll<HTMLElement>("[data-step-copy] .demo-step")];
  const show = (step: number) => {
    buttons.forEach((b, i) => { if (i === step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); });
    copies.forEach((c, i) => c.classList.toggle("is-on", i === step));
    live.setStep(step);
  };
  document.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-goto-step]");
    if (target) show(Number(target.dataset.gotoStep));
  });
  show(0);
}
