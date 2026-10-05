import { For, Show } from "solid-js";

export interface Star {
  /** Horizontal position in percent of the sky. */
  x: number;
  /** Vertical position in percent of the sky. */
  y: number;
  size: number;
  opacity: number;
  duration: number;
  delay: number;
  glow: boolean;
}

/** Deterministic star field: every start shows the same sky. Stars thin out
 * towards the bottom, where the sky fades into the sidebar. */
export function createStars(count: number, seed: number): Star[] {
  let state = seed;
  const next = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const glow = next() > 0.88;
    const size = glow ? 2 : next() > 0.6 ? 1.4 : 1;
    stars.push({
      x: next() * 100,
      y: Math.pow(next(), 1.5) * 78,
      size,
      opacity: 0.35 + next() * 0.65,
      duration: 2.5 + next() * 4,
      delay: next() * 6,
      glow,
    });
  }
  return stars;
}

const fixed = (value: number, digits = 2) => value.toFixed(digits);

/** Decorative night sky of nightly builds. `head` sits behind the sidebar
 * head and fades out; `fill` covers its container (boot screen, dialogs). */
export function NightSky(props: { variant?: "head" | "fill"; count?: number; seed?: number; moon?: boolean }) {
  const variant = () => props.variant ?? "head";
  const stars = createStars(props.count ?? 46, props.seed ?? 7);
  return (
    <div class={`night-sky is-${variant()}`} aria-hidden="true">
      <For each={stars}>{(star) =>
        <span class="night-star" classList={{ "is-glow": star.glow }} style={{
          "--x": `${fixed(star.x)}%`, "--y": `${fixed(star.y)}%`, "--s": `${star.size}px`,
          "--o": fixed(star.opacity), "--d": `${fixed(star.duration, 1)}s`, "--delay": `-${fixed(star.delay, 1)}s`,
        }} />
      }</For>
      <Show when={variant() === "head"}>
        <span class="night-cloud is-a" /><span class="night-cloud is-b" /><span class="night-cloud is-c" />
      </Show>
      <Show when={props.moon ?? variant() === "head"}><span class="night-moon" /></Show>
      <span class="night-shooting" />
    </div>
  );
}
