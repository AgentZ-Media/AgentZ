#!/usr/bin/env node
/**
 * @agentz/design - logo + app icon export.
 *
 * Single source of truth is `../logo.ts` (dot geometry). This script turns
 * it into standalone files and fans the raster versions out to every place
 * in the monorepo that ships the icon:
 *
 *   packages/design/assets/
 *     scriptz-mark.svg           bare Z, ink + graphite (light backgrounds)
 *     scriptz-mark-inverse.svg   bare Z, chalk + highlighter (dark backgrounds)
 *     scriptz-app-icon.svg       app icon ("App-Icon hell" in concept.html)
 *     scriptz-app-icon.png       1024 px raster of the app icon
 *   apps/landing/public/img/icon.png        400 px (favicon, nav)
 *   apps/landing/public/img/icon-large.png  1024 px (OG image, JSON-LD logo)
 *   apps/desktop/src-tauri/icons/**          full Tauri set via `tauri icon`
 *   apps/desktop/src-tauri/icons/icon.iconset/*
 *
 * The app icon follows the macOS icon grid: 1024 canvas, 824 tile at 100 px
 * inset, corner radius 22.5 % of the tile - the same geometry as the
 * pre-redesign icon, so it sits right next to other apps in the Dock.
 *
 * Usage (from the repo root, needs Google Chrome for the SVG -> PNG step):
 *   node packages/design/scripts/build-logo.mjs
 *   node packages/design/scripts/build-logo.mjs --svg-only
 *   CHROME=/path/to/chrome node packages/design/scripts/build-logo.mjs
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LOGO_DOTS, LOGO_DOT_R, LOGO_HEIGHT, LOGO_VIEWBOX, LOGO_WIDTH } from "../logo.ts";

const here = dirname(fileURLToPath(import.meta.url));
const designDir = resolve(here, "..");
const repoRoot = resolve(designDir, "../..");
const assetsDir = join(designDir, "assets");

// Palette of the light app icon (concept.html `.lg-light`) and the inverse
// mark (`.lg-dark`). Mirrors `.app-mark.is-light` / `.is-dark` in
// components.css - change both together.
const INK = "#14161b";
const GRAPHITE = "#5d6170";
const CHALK = "#f1f2f4";
const HIGHLIGHTER = "#ffe14d";

// macOS icon grid.
const CANVAS = 1024;
const TILE = 824;
const INSET = (CANVAS - TILE) / 2;
const RADIUS = TILE * 0.225;
// Glyph width relative to the tile (concept: `.lg-tile svg { width: 40% }`).
const GLYPH_SHARE = 0.4;
// Paper grid: 19 cells across the tile, symmetric around the centre.
const GRID_CELLS = 19;

const fmt = (n) => Number(n.toFixed(2)).toString();

function dots({ main, sub, scale = 1, dx = 0, dy = 0 }) {
  return LOGO_DOTS.map(
    (d) =>
      `<circle cx="${fmt(dx + d.cx * scale)}" cy="${fmt(dy + d.cy * scale)}" r="${fmt(LOGO_DOT_R * scale)}" fill="${d.tone === "main" ? main : sub}"/>`,
  ).join("\n  ");
}

function markSvg(main, sub, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}" width="${LOGO_WIDTH * 4}" height="${LOGO_HEIGHT * 4}" role="img" aria-label="${title}">
  <title>${title}</title>
  ${dots({ main, sub })}
</svg>
`;
}

function appIconSvg() {
  const glyphW = TILE * GLYPH_SHARE;
  const scale = glyphW / LOGO_WIDTH;
  const dx = CANVAS / 2 - glyphW / 2;
  const dy = CANVAS / 2 - (LOGO_HEIGHT * scale) / 2;
  const pitch = TILE / GRID_CELLS;
  const lines = [];
  for (let i = 1; i < GRID_CELLS; i++) {
    const p = fmt(INSET + i * pitch);
    lines.push(`M${p} ${INSET}V${INSET + TILE}M${INSET} ${p}H${INSET + TILE}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}" role="img" aria-label="ScriptZ">
  <title>ScriptZ</title>
  <defs>
    <linearGradient id="sheet" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#eceef1"/>
    </linearGradient>
    <clipPath id="tile">
      <rect x="${INSET}" y="${INSET}" width="${TILE}" height="${TILE}" rx="${fmt(RADIUS)}"/>
    </clipPath>
  </defs>
  <rect x="${INSET}" y="${INSET}" width="${TILE}" height="${TILE}" rx="${fmt(RADIUS)}" fill="url(#sheet)"/>
  <path clip-path="url(#tile)" fill="none" stroke="#e6e8ec" stroke-width="1.5" d="${lines.join("")}"/>
  <rect x="${INSET + 2}" y="${INSET + 2}" width="${TILE - 4}" height="${TILE - 4}" rx="${fmt(RADIUS - 2)}" fill="none" stroke="#d3d6dc" stroke-width="4"/>
  ${dots({ main: INK, sub: GRAPHITE, scale, dx, dy })}
</svg>
`;
}

function findChrome() {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const hit = candidates.find((c) => existsSync(c));
  if (!hit) throw new Error("Google Chrome not found - set CHROME=/path/to/chrome or use --svg-only.");
  return hit;
}

/** Renders an SVG file to a square, transparent PNG of `size` px. */
function renderPng(chrome, svgPath, outPath, size) {
  const tmp = mkdtempSync(join(tmpdir(), "agentz-logo-"));
  const html = join(tmp, "render.html");
  writeFileSync(
    html,
    `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${pathToFileURL(svgPath).href}">`,
  );
  try {
    // stdout/stderr are piped, not ignored: on failure Node puts Chrome's
    // stderr into the thrown error message.
    execFileSync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      `--screenshot=${outPath}`,
      pathToFileURL(html).href,
    ], { stdio: ["ignore", "pipe", "pipe"] });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

mkdirSync(assetsDir, { recursive: true });
const iconSvg = join(assetsDir, "scriptz-app-icon.svg");
writeFileSync(join(assetsDir, "scriptz-mark.svg"), markSvg(INK, GRAPHITE, "ScriptZ"));
writeFileSync(join(assetsDir, "scriptz-mark-inverse.svg"), markSvg(CHALK, HIGHLIGHTER, "ScriptZ"));
writeFileSync(iconSvg, appIconSvg());
console.log("svg  -> packages/design/assets/");

if (process.argv.includes("--svg-only")) process.exit(0);

const chrome = findChrome();
const iconPng = join(assetsDir, "scriptz-app-icon.png");
renderPng(chrome, iconSvg, iconPng, CANVAS);
console.log("png  -> packages/design/assets/scriptz-app-icon.png");

// Landing (Astro, imports nothing from the workspace - gets copies).
const landingImg = join(repoRoot, "apps/landing/public/img");
copyFileSync(iconPng, join(landingImg, "icon-large.png"));
renderPng(chrome, iconSvg, join(landingImg, "icon.png"), 400);
console.log("png  -> apps/landing/public/img/{icon,icon-large}.png");

// Desktop: the full Tauri set (icns, ico, Windows Store tiles, iOS, Android).
const desktopDir = join(repoRoot, "apps/desktop");
// pnpm is a .cmd shim on Windows, which execFileSync can only start via a
// shell. The relative path keeps the argument free of spaces for that shell.
execFileSync("pnpm", ["tauri", "icon", relative(desktopDir, iconPng)], {
  cwd: desktopDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});

// The checked-in iconset mirrors icon.icns for `iconutil` users.
const iconset = join(desktopDir, "src-tauri/icons/icon.iconset");
mkdirSync(iconset, { recursive: true });
for (const base of [16, 32, 128, 256, 512]) {
  for (const [suffix, px] of [["", base], ["@2x", base * 2]]) {
    renderPng(chrome, iconSvg, join(iconset, `icon_${base}x${base}${suffix}.png`), px);
  }
}
console.log("png  -> apps/desktop/src-tauri/icons/icon.iconset/");
