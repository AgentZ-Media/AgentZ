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

export interface LogoDefinition {
  viewBox: string;
  width: number;
  height: number;
  dotRadius: number;
  dots: readonly LogoDot[];
  /** Accent used by the shared mark and inverse export. */
  accent: string;
}

// Five-column glyphs keep generated products in the existing dot-matrix family.
const GLYPHS: Record<string, readonly string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

/** Create an app's initial mark; unsupported initials use the suite Z. */
export function createLogo(glyph: string, accent = "#ffe14d"): LogoDefinition {
  if (!/^#[0-9a-f]{6}$/i.test(accent)) throw new Error("Logo accent must be a six-digit hex colour");
  const rows = GLYPHS[glyph.toUpperCase()] ?? GLYPHS.Z!;
  return {
    viewBox: "0 0 50 70", width: 50, height: 70, dotRadius: LOGO_DOT_R, accent,
    dots: rows.flatMap((row, y) => [...row].flatMap((dot, x): LogoDot[] =>
      dot === "1" ? [{ cx: x * 10 + 5, cy: y * 10 + 5, tone: "main" }] : [],
    )),
  };
}

const suiteMark: LogoDefinition = {
  viewBox: LOGO_VIEWBOX,
  width: LOGO_WIDTH,
  height: LOGO_HEIGHT,
  dotRadius: LOGO_DOT_R,
  dots: LOGO_DOTS,
  accent: "#ffe14d",
};

/** Product marks rendered by shared chrome; ScriptZ keeps its original geometry. */
export const LOGOS = {
  suite: suiteMark,
  scriptz: suiteMark,
  // new-app:logos
} as const satisfies Record<string, LogoDefinition>;

export type LogoId = keyof typeof LOGOS;
