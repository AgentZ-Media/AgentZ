/**
 * @agentz/design - logo mark.
 *
 * The dot-matrix "Z" (6 rows x 5 columns) from `#logo-z` in
 * docs/redesign/concept.html, as data so any renderer (Solid, Astro,
 * canvas, icon build scripts) can draw it.
 *
 * Rendering contract (matches the concept):
 * - viewBox `LOGO_VIEWBOX`, every dot is a circle with radius `LOGO_DOT_R`.
 * - "main" dots: `fill: var(--z1, currentColor)`.
 * - "sub" dots (the two diagonal shadow rows): `fill: var(--z2, currentColor)`
 *   at `opacity: var(--z2o, 0.62)`. On the yellow accent tile the
 *   concept uses `--z2o: 0.5`.
 *
 * Standalone SVG/PNG exports and the app icon set are generated from this
 * file by `scripts/build-logo.mjs` (see README, "Logo and app icon").
 */

export const LOGO_VIEWBOX = "0 0 50 60";
export const LOGO_WIDTH = 50;
export const LOGO_HEIGHT = 60;
export const LOGO_DOT_R = 3.1;

export type LogoTone = "main" | "sub";

export interface LogoDot {
  cx: number;
  cy: number;
  tone: LogoTone;
}

/** Row-major (top to bottom, left to right). */
export const LOGO_DOTS: readonly LogoDot[] = [
  { cx: 5, cy: 5, tone: "main" },
  { cx: 15, cy: 5, tone: "main" },
  { cx: 25, cy: 5, tone: "main" },
  { cx: 35, cy: 5, tone: "main" },
  { cx: 45, cy: 5, tone: "main" },
  { cx: 5, cy: 15, tone: "sub" },
  { cx: 15, cy: 15, tone: "sub" },
  { cx: 25, cy: 15, tone: "sub" },
  { cx: 35, cy: 15, tone: "main" },
  { cx: 45, cy: 15, tone: "main" },
  { cx: 25, cy: 25, tone: "main" },
  { cx: 35, cy: 25, tone: "main" },
  { cx: 15, cy: 35, tone: "main" },
  { cx: 25, cy: 35, tone: "main" },
  { cx: 5, cy: 45, tone: "main" },
  { cx: 15, cy: 45, tone: "main" },
  { cx: 25, cy: 45, tone: "sub" },
  { cx: 35, cy: 45, tone: "sub" },
  { cx: 45, cy: 45, tone: "sub" },
  { cx: 5, cy: 55, tone: "main" },
  { cx: 15, cy: 55, tone: "main" },
  { cx: 25, cy: 55, tone: "main" },
  { cx: 35, cy: 55, tone: "main" },
  { cx: 45, cy: 55, tone: "main" },
];
