// The yellow dot that travels down the home page. It starts as the period
// of the headline and ends as the period of the landing headline. In between
// it docks at every waypoint (`[data-way]`): while a waypoint sits in the
// middle of the viewport the dot rides on it, between two waypoints it flies,
// driven by the scroll position alone. Waypoints marked `data-way="glide"`
// are reached in one even movement (the path stages), all others with a
// short rest on both ends.

const BASE = 400;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Point { el: Element; host: HTMLElement; x: number; y: number; size: number; s: number; glide: boolean }

export function startJourney(dot: HTMLElement, onMove: (x: number, y: number, r: number) => void) {
  const ways = [...document.querySelectorAll<Element>("[data-way]")];
  if (ways.length < 2) return;
  const hosts = ways.map((el) => el.closest<HTMLElement>("[data-near]") ?? (el as HTMLElement));
  const line = document.querySelector<SVGPathElement>("[data-path-line]");
  const lineFill = document.querySelector<SVGPathElement>("[data-path-fill]");
  const track = document.querySelector<HTMLElement>("[data-path]");
  const stageIdx = ways.map((el, i) => (el.closest("[data-path]") ? i : -1)).filter((i) => i >= 0);
  const rail = document.querySelector<HTMLElement>("[data-rail]");
  const railMark = rail?.querySelector<HTMLElement>("[data-rail-mark]");
  const railButtons = rail ? [...rail.querySelectorAll<HTMLButtonElement>("button")] : [];
  const railAt = ways.map((el, i) => (el.hasAttribute("data-rail") ? i : -1)).filter((i) => i >= 0);
  let points: Point[] = [];

  // The path between the stage dots, in the track's own coordinates: from
  // each dot straight down beside its text, across in the gap between two
  // stages, then down into the next dot. Sampled into points so the dot can
  // ride exactly on the line.
  let segments: { pts: [number, number][]; cum: number[] }[] = [];
  let total = 0;
  function layoutLine() {
    if (!track || !line || !lineFill) return;
    const box = track.getBoundingClientRect();
    const local = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, top: r.top - box.top, bottom: r.bottom - box.top }; };
    const dots = stageIdx.map((i) => local(ways[i]!));
    const rows = stageIdx.map((i) => local(ways[i]!.closest("li") ?? ways[i]!));
    segments = dots.slice(1).map((b, n) => {
      const a = dots[n]!;
      const yc = (rows[n]!.bottom + rows[n + 1]!.top) / 2;
      const r = Math.max(0, Math.min(28, Math.abs(b.x - a.x) / 2, (yc - a.y) / 2, (b.y - yc) / 2));
      const dir = Math.sign(b.x - a.x) || 1;
      const pts: [number, number][] = [[a.x, a.y], [a.x, yc - r]];
      const corner = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number) => {
        for (let k = 1; k <= 8; k++) {
          const t = k / 8, u = 1 - t;
          pts.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
        }
      };
      if (r > 0) {
        corner(a.x, yc - r, a.x, yc, a.x + dir * r, yc);
        pts.push([b.x - dir * r, yc]);
        corner(b.x - dir * r, yc, b.x, yc, b.x, yc + r);
      }
      pts.push([b.x, b.y]);
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1]! + Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]));
      return { pts, cum };
    });
    total = segments.reduce((n, seg) => n + seg.cum[seg.cum.length - 1]!, 0);
    const d = segments.flatMap((seg, n) => seg.pts.slice(n ? 1 : 0)).map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    line.setAttribute("d", d);
    lineFill.setAttribute("d", d);
    lineFill.style.strokeDasharray = `${total} ${total}`;
    track.querySelector("svg")?.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  }

  /** Point at `t` (0..1, by length) on path segment `n`, in track coordinates. */
  function along(n: number, t: number): [number, number] {
    const seg = segments[n];
    if (!seg) return [0, 0];
    const len = seg.cum[seg.cum.length - 1]! * t;
    let k = 1;
    while (k < seg.cum.length - 1 && seg.cum[k]! < len) k++;
    const l0 = seg.cum[k - 1]!, l1 = seg.cum[k]!;
    const u = l1 > l0 ? (len - l0) / (l1 - l0) : 0;
    const [x0, y0] = seg.pts[k - 1]!, [x1, y1] = seg.pts[k]!;
    return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
  }

  function measure() {
    const vh = window.innerHeight;
    const y0 = window.scrollY;
    points = ways.map((el, i) => {
      const r = el.getBoundingClientRect();
      return { el, host: hosts[i]!, x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.max(4, r.width), s: y0 + r.top + r.height / 2 - vh / 2, glide: el.getAttribute("data-way") === "glide" };
    });
    for (let i = 1; i < points.length; i++) points[i]!.s = Math.max(points[i]!.s, points[i - 1]!.s);
  }

  let lastKey = "";
  function frame() {
    measure();
    const y0 = window.scrollY;
    const last = points.length - 1;
    let i = 0;
    while (i < last && points[i + 1]!.s <= y0) i++;
    let x: number, y: number, size: number, f: number;
    const a = points[i]!;
    if (y0 <= points[0]!.s || i === last) {
      x = a.x; y = a.y; size = a.size; f = i;
    } else {
      const b = points[i + 1]!;
      const span = b.s - a.s;
      const t = span < 1 ? 1 : clamp((y0 - a.s) / span);
      const te = b.glide && a.glide ? t : smooth(clamp((t - 0.16) / 0.68));
      const seg = stageIdx.indexOf(i);
      if (b.glide && a.glide && track && segments[seg]) {
        const box = track.getBoundingClientRect();
        const [px, py] = along(seg, te);
        x = box.left + px; y = box.top + py;
      } else {
        x = a.x + (b.x - a.x) * inOut(te);
        y = a.y + (b.y - a.y) * te;
      }
      size = Math.exp(Math.log(a.size) + (Math.log(b.size) - Math.log(a.size)) * te);
      f = i + te;
    }
    dot.style.transform = `translate3d(${x - BASE / 2}px, ${y - BASE / 2}px, 0) scale(${size / BASE})`;
    onMove(x, y, size / 2);

    // Waypoints react to how close the dot is.
    points.forEach((p, j) => {
      const near = clamp(1 - Math.abs(f - j) * 1.4);
      p.host.style.setProperty("--near", near.toFixed(3));
      p.host.classList.toggle("is-past", f >= j - 0.02);
      p.host.classList.toggle("is-here", near > 0.75);
    });

    // The path fills up to the dot.
    if (lineFill && segments.length) {
      const pos = clamp(f - stageIdx[0]!, 0, segments.length);
      const n = Math.min(segments.length - 1, Math.floor(pos));
      const done = segments.slice(0, n).reduce((m, seg) => m + seg.cum[seg.cum.length - 1]!, 0) + segments[n]!.cum[segments[n]!.cum.length - 1]! * (pos - n);
      lineFill.style.strokeDashoffset = String(total - done);
    }

    // The rail marker moves continuously between its section dots.
    if (railMark && railAt.length > 1) {
      let k = 0;
      while (k < railAt.length - 1 && railAt[k + 1]! <= f) k++;
      const from = railAt[k]!, to = railAt[k + 1] ?? from;
      const pos = to === from ? k : k + clamp((f - from) / (to - from));
      railMark.style.setProperty("--pos", (pos / (railAt.length - 1)).toFixed(4));
      const key = String(Math.floor(pos + 0.15));
      if (key !== lastKey) {
        lastKey = key;
        railButtons.forEach((b, n) => { if (n === Math.floor(pos + 0.15)) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
      }
    }
    requestAnimationFrame(frame);
  }

  railButtons.forEach((button, n) => button.addEventListener("click", () => {
    measure();
    const p = points[railAt[n] ?? 0];
    if (p) window.scrollTo({ top: Math.max(0, p.s), behavior: "smooth" });
  }));

  layoutLine();
  new ResizeObserver(layoutLine).observe(document.body);
  document.documentElement.classList.add("has-dot");
  requestAnimationFrame(frame);
}
