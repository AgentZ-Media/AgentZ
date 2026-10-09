// The dot field behind every page: a quiet grid in the logo's rhythm.
// Scenes (logo, words, clock, arrow, frames) pull single dots out of the
// grid; the dots fly there on springs and sink back into the grid when the
// scene leaves. Colours are read from the design tokens at start.

export type Tone = "fg" | "sub" | "accent" | "char1" | "char2" | "char3" | "char4" | "char5";

/** A dot in scene coordinates (CSS pixels from the anchor's top left). */
export interface ScenePoint { x: number; y: number; r: number; tone: Tone }

export interface Scene {
  el: HTMLElement;
  /** Shown right now? Called every frame. */
  active: () => boolean;
  /** Points for the anchor's current size. Re-read whenever `version` changes. */
  points: (width: number, height: number) => ScenePoint[];
  version: () => number;
  /** Extra vertical offset per frame (bounce). */
  drift?: (time: number) => number;
  /** A diagonal accent sweep runs over the scene every few seconds. */
  sweep?: boolean;
}

interface Actor {
  x: number; y: number; vx: number; vy: number;
  r: number; tr: number; a: number;
  tone: Tone;
  scene: Scene | null;
  tx: number; ty: number;
  /** Intro: when this dot pops in, as a share of the zoom. */
  delay: number;
}

interface Bound { scene: Scene; key: string; pts: ScenePoint[]; left: number; top: number; w: number; h: number; actors: Actor[] }

const TONES: Record<Tone, string> = {
  fg: "--fg", sub: "--muted", accent: "--accent",
  char1: "--char-1", char2: "--char-2", char3: "--char-3", char4: "--char-4", char5: "--char-5",
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Pops in with a small overshoot. */
const backOut = (t: number) => { const c = 1.7; return t <= 0 ? 0 : 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

export function startDotField(canvas: HTMLCanvasElement, scenes: Scene[], reducedMotion: boolean) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const style = getComputedStyle(document.documentElement);
  const color = Object.fromEntries(Object.entries(TONES).map(([tone, prop]) => [tone, style.getPropertyValue(prop).trim()])) as Record<Tone, string>;
  const gridColor = color.fg;

  let width = 0, height = 0, dpr = 1, step = 28, ox = 0, oy = 0;
  let grid: Float32Array = new Float32Array(0);
  const actors: Actor[] = [];
  let bound: Bound[] = [];
  const pointer = { x: -9999, y: -9999, on: false };
  const waves: { x: number; y: number; t: number }[] = [];
  const lamp = { x: 0, y: 0, r: 0 };
  // Intro: the page opens on one giant dot and zooms out until it is one
  // small dot of a cluster, and the cluster one dot of the suite Z.
  const intro = { on: false, ready: false, p: 0, last: 0, dur: 1, fast: false, focus: null as Actor | null, accentUntil: 0, done: () => {} };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    step = width < 700 ? 22 : 28;
    ox = ((width % step) + step) / 2;
    oy = ((height % step) + step) / 2;
    const cols = Math.ceil(width / step) + 1;
    const rows = Math.ceil(height / step) + 1;
    grid = new Float32Array(cols * rows * 2);
    let i = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { grid[i++] = ox + c * step - step / 2; grid[i++] = oy + r * step - step / 2; }
    bound = [];
  }

  const snap = (v: number, o: number) => Math.round((v - o + step / 2) / step) * step + o - step / 2;

  function spawn(): Actor {
    const x = snap(Math.random() * width, ox);
    const y = snap(Math.random() * height, oy);
    const actor: Actor = { x, y, vx: 0, vy: 0, r: 1.2, tr: 1.2, a: 0, tone: "fg", scene: null, tx: x, ty: y, delay: 0 };
    actors.push(actor);
    return actor;
  }

  /** Re-deal actors to points: each point takes the nearest free dot. */
  function assign(next: Bound[]) {
    for (const actor of actors) actor.scene = null;
    const free = new Set(actors);
    for (const b of next) {
      b.actors = [];
      const order = b.pts.map((_, i) => i).sort(() => Math.random() - 0.5);
      const slots: Actor[] = new Array(b.pts.length);
      for (const i of order) {
        const p = b.pts[i]!;
        const px = b.left + p.x, py = b.top + p.y;
        let best: Actor | null = null, bestD = Infinity;
        for (const actor of free) {
          const d = (actor.x - px) ** 2 + (actor.y - py) ** 2;
          if (d < bestD) { bestD = d; best = actor; }
        }
        const actor = best ?? spawn();
        free.delete(actor);
        actor.scene = b.scene;
        slots[i] = actor;
      }
      b.actors = slots;
    }
    bound = next;
  }

  let lastKey = "";
  function update(time: number) {
    // Which scenes are on, and did anything about them change?
    const next: Bound[] = [];
    let changed = false;
    for (const scene of scenes) {
      if (!scene.active()) continue;
      const rect = scene.el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const key = `${scene.version()}:${Math.round(rect.width)}x${Math.round(rect.height)}`;
      const prev = bound.find((b) => b.scene === scene);
      if (prev && prev.key === key) {
        // Ride along with the content so scrolling never wobbles the shape.
        const dx = rect.left - prev.left, dy = rect.top - prev.top;
        if (dx || dy) for (const actor of prev.actors) { actor.x += dx; actor.y += dy; }
        prev.left = rect.left; prev.top = rect.top;
        next.push(prev);
      } else {
        changed = true;
        next.push({ scene, key, pts: scene.points(rect.width, rect.height), left: rect.left, top: rect.top, w: rect.width, h: rect.height, actors: [] });
      }
    }
    const setKey = next.map((b) => scenes.indexOf(b.scene)).join(",");
    if (changed || setKey !== lastKey) { assign(next); lastKey = setKey; }

    // Targets.
    for (const b of bound) {
      const drift = b.scene.drift?.(time) ?? 0;
      const sweepAt = b.scene.sweep && !intro.on && time > intro.accentUntil ? ((time / 5200) % 1.6) - 0.3 : -9;
      b.pts.forEach((p, i) => {
        const actor = b.actors[i];
        if (!actor) return;
        actor.tx = b.left + p.x;
        actor.ty = b.top + p.y + drift;
        actor.tr = p.r;
        const band = (p.x / b.w) * 0.7 + (p.y / b.h) * 0.3 - sweepAt;
        actor.tone = band > 0 && band < 0.12 ? "accent" : p.tone;
      });
    }
    for (const actor of actors) {
      if (actor.scene) continue;
      actor.tx = snap(actor.x, ox);
      actor.ty = snap(actor.y, oy);
      actor.tr = 1.2;
    }

    if (intro.on && !intro.ready) {
      const b = bound[0];
      if (!b) { finishIntro(time); }
      else {
        // Put every dot in place at once; the camera does the motion.
        const cx = b.left + b.w / 2, cy = b.top + b.h / 2;
        let best: Actor | null = null, bestD = Infinity;
        for (const actor of b.actors) {
          actor.x = actor.tx; actor.y = actor.ty; actor.r = actor.tr; actor.a = 1; actor.vx = 0; actor.vy = 0;
          const d = Math.hypot(actor.x - cx, actor.y - cy);
          if (d < bestD) { bestD = d; best = actor; }
        }
        intro.focus = best;
        const far = Math.max(...b.actors.map((a) => Math.hypot(a.x - best!.x, a.y - best!.y)), 1);
        for (const actor of b.actors) actor.delay = 0.04 + (Math.hypot(actor.x - best!.x, actor.y - best!.y) / far) * 0.5;
        intro.ready = true;
        intro.last = time;
      }
    }
    if (intro.on) {
      for (const actor of actors) if (actor.scene) { actor.x = actor.tx; actor.y = actor.ty; actor.r = actor.tr; actor.a = 1; }
      return;
    }

    // Physics.
    for (const actor of actors) {
      const home = !actor.scene;
      if (reducedMotion) {
        actor.x = actor.tx; actor.y = actor.ty; actor.r = actor.tr; actor.a = home ? 0 : 1;
        continue;
      }
      let ax = (actor.tx - actor.x) * (home ? 0.03 : 0.055);
      let ay = (actor.ty - actor.y) * (home ? 0.03 : 0.055);
      if (pointer.on && !home) {
        const dx = actor.x - pointer.x, dy = actor.y - pointer.y;
        const d = Math.hypot(dx, dy);
        if (d < 120 && d > 0.01) { const f = (1 - d / 120) ** 2 * 6; ax += (dx / d) * f; ay += (dy / d) * f; }
      }
      actor.vx = (actor.vx + ax) * 0.8;
      actor.vy = (actor.vy + ay) * 0.8;
      actor.x += actor.vx;
      actor.y += actor.vy;
      actor.r += (actor.tr - actor.r) * 0.12;
      const near = Math.abs(actor.tx - actor.x) + Math.abs(actor.ty - actor.y);
      actor.a += ((home ? (near < 2 ? 0 : 0.5) : 1) - actor.a) * 0.08;
    }
  }

  function finishIntro(time: number) {
    if (!intro.on) return;
    intro.on = false;
    intro.accentUntil = time + 1800;
    if (intro.focus) waves.push({ x: intro.focus.x, y: intro.focus.y, t: time });
    intro.done();
  }

  /** Camera of the intro: zoom factor and the screen point of the focus dot. */
  function camera(time: number) {
    if (!intro.on || !intro.ready || !intro.focus) return null;
    const dt = Math.min(64, time - intro.last);
    intro.last = time;
    intro.p = Math.min(1, intro.p + (dt / intro.dur) * (intro.fast ? 7 : 1));
    if (intro.p >= 1) { finishIntro(time); return null; }
    // The page fades in while the camera settles on the standing Z.
    if (intro.p >= 0.6) intro.done();
    const f = intro.focus;
    const z0 = (Math.min(width, height) * 0.36) / Math.max(1, f.r);
    const pop = clamp01(intro.p / 0.08);
    // Moves from the first frame and only eases out at the end.
    const zt = intro.p;
    const ze = zt + zt ** 2 - zt ** 3;
    const z = Math.exp(Math.log(z0) * (1 - ze));
    const cx = width / 2 + (f.x - width / 2) * ze;
    const cy = height / 2 + (f.y - height / 2) * ze;
    return { z, cx, cy, fx: f.x, fy: f.y, ze, pop };
  }

  function draw(time: number) {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, width, height);
    const cam = camera(time);
    if (intro.on && !cam) return;

    // The grid, bucketed by brightness so it stays a handful of fills.
    const buckets: Path2D[] = Array.from({ length: 6 }, () => new Path2D());
    const lit: [number, number, number, number][] = [];
    const t = reducedMotion ? 0 : time;
    for (let i = 0; i < grid.length; i += 2) {
      const x = grid[i]!, y = grid[i + 1]!;
      const wave = reducedMotion ? 0 : (Math.sin(x * 0.006 + y * 0.004 - t * 0.0007) + 1) / 2;
      let glow = 0;
      if (pointer.on && !cam) {
        const d = Math.hypot(x - pointer.x, y - pointer.y);
        if (d < 170) glow = (1 - d / 170) ** 2;
      }
      if (lamp.r > 0 && !intro.on) {
        const d = Math.hypot(x - lamp.x, y - lamp.y) - lamp.r;
        const reach = 60 + lamp.r * 0.9;
        if (d < reach) glow = Math.max(glow, (1 - Math.max(0, d) / reach) ** 2 * 0.9);
      }
      for (const w of waves) {
        const ring = (time - w.t) * 0.9;
        const d = Math.abs(Math.hypot(x - w.x, y - w.y) - ring);
        if (d < 40) glow = Math.max(glow, (1 - d / 40) * Math.max(0, 1 - ring / 900));
      }
      if (glow > 0.04) { lit.push([x, y, 1.2 + glow * 2.6, glow]); continue; }
      const b = Math.min(5, Math.floor(wave * wave * 6));
      buckets[b]!.moveTo(x + 1.2, y);
      buckets[b]!.arc(x, y, 1.2, 0, Math.PI * 2);
    }
    const gridFade = cam ? clamp01(1 - Math.log(cam.z) / Math.log(4)) : 1;
    ctx!.fillStyle = gridColor;
    buckets.forEach((path, b) => { ctx!.globalAlpha = (0.07 + b * 0.025) * gridFade; ctx!.fill(path); });
    ctx!.fillStyle = color.accent;
    for (const [x, y, r, g] of lit) {
      ctx!.globalAlpha = 0.18 + g * 0.82;
      ctx!.beginPath(); ctx!.arc(x, y, r, 0, Math.PI * 2); ctx!.fill();
    }

    // Actors on top, seen through the intro camera while it runs.
    for (const actor of actors) {
      if (actor.a < 0.02) continue;
      let x = actor.x, y = actor.y, r = actor.r;
      const focus = actor === intro.focus && (intro.on || time < intro.accentUntil);
      if (cam) {
        if (!actor.scene) continue;
        x = cam.cx + (actor.x - cam.fx) * cam.z;
        y = cam.cy + (actor.y - cam.fy) * cam.z;
        const grow = actor === intro.focus ? backOut(cam.pop) : backOut(clamp01((cam.ze - actor.delay) / 0.14));
        r = actor.r * cam.z * grow;
        if (r < 0.3 || x + r < 0 || x - r > width || y + r < 0 || y - r > height) continue;
      }
      const tone: Tone = focus ? "accent" : actor.tone;
      ctx!.globalAlpha = actor.a * (tone === "sub" ? 0.62 : 1);
      ctx!.fillStyle = color[tone];
      if (focus && cam) { ctx!.shadowColor = color.accent; ctx!.shadowBlur = Math.min(120, r * 0.5); }
      ctx!.beginPath(); ctx!.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2); ctx!.fill();
      ctx!.shadowBlur = 0;
    }
    ctx!.globalAlpha = 1;
    while (waves.length && time - waves[0]!.t > 1100) waves.shift();
  }

  resize();
  window.addEventListener("resize", resize);
  if (!reducedMotion) {
    window.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      pointer.x = event.clientX; pointer.y = event.clientY; pointer.on = true;
    }, { passive: true });
    document.addEventListener("pointerleave", () => { pointer.on = false; });
    window.addEventListener("blur", () => { pointer.on = false; });
  }

  const skip = () => { intro.fast = true; };
  return {
    /** Plays the zoom-out intro once; resolves as soon as the Z stands. */
    intro(ms: number) {
      if (reducedMotion) return Promise.resolve();
      intro.on = true; intro.dur = ms;
      for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) window.addEventListener(type, skip, { once: true, passive: true });
      return new Promise<void>((resolve) => { intro.done = resolve; });
    },
    /** The travelling dot lights the grid around it. */
    light(x: number, y: number, r: number) { lamp.x = x; lamp.y = y; lamp.r = r; },
    /** A shock wave from a point: dots jump away, the grid rings. */
    burst(x: number, y: number) {
      if (reducedMotion) return;
      waves.push({ x, y, t: performance.now() });
      for (const actor of actors) {
        const dx = actor.x - x, dy = actor.y - y;
        const d = Math.hypot(dx, dy);
        if (d < 360 && d > 0.01) { const f = (1 - d / 360) * 26; actor.vx += (dx / d) * f; actor.vy += (dy / d) * f; }
      }
    },
    loop() {
      const frame = (time: number) => {
        if (!document.hidden) { update(time); draw(time); }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
  };
}
