import { For } from "solid-js";

/** Grid cells (12 px) that light up in the accent: column, row, cycle and
 *  phase in seconds. Fixed, so every start shows the same pattern. */
const LIT: readonly (readonly [number, number, number, number])[] = [
  [3, 1, 4.2, 0], [9, 2, 5.4, 1.4], [15, 1, 4.8, 2.6], [18, 4, 6.2, 0.8], [6, 5, 5.6, 3.4],
  [12, 6, 4.4, 4.2], [1, 8, 6.8, 2.1], [16, 9, 5.2, 5.1], [8, 11, 6.1, 1.1], [13, 13, 7, 3.8],
];

/** Signature of stable builds behind the sidebar head: the dot grid of the
 *  app marks, a few dots breathing in the accent colour and a slow
 *  highlighter sweep. Nightly builds show the night sky instead. */
export function SideDots() {
  return (
    <div class="side-dots" aria-hidden="true">
      <span class="side-dots-sweep" />
      <For each={LIT}>{([x, y, cycle, phase]) =>
        <i class="side-dot" style={{ "--gx": String(x), "--gy": String(y), "--dur": `${cycle}s`, "--dl": `-${phase}s` }} />
      }</For>
    </div>
  );
}
