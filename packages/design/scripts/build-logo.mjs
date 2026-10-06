#!/usr/bin/env node
/** Build a registered app's assets, desktop icons and website thumbnail.
 * node packages/design/scripts/build-logo.mjs --app scriptz [--svg-only | --fallback | --nightly]
 * Without Chrome, the bundled suite placeholder keeps desktop builds possible.
 * `--nightly` only writes the night-sky icon set for nightly builds
 * (`apps/<id>/src-tauri/icons-nightly`); it requires Chrome.
 */

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LOGOS } from "../logo.ts";

const here = dirname(fileURLToPath(import.meta.url));
const designDir = resolve(here, "..");
const repoRoot = resolve(designDir, "../..");
const assetsDir = join(designDir, "assets");

// Bare mark palette. App tiles use the same accent and ink as AppMark.
const INK = "#14161b";
const GRAPHITE = "#5d6170";
const CHALK = "#f1f2f4";

// macOS icon grid.
const CANVAS = 1024;
const TILE = 824;
const INSET = (CANVAS - TILE) / 2;
const RADIUS = TILE * 0.28;
// Matches the shared in-app AppMark glyph proportions.
const GLYPH_SHARE = 0.46;

const fmt = (n) => Number(n.toFixed(2)).toString();

function dots(logo, { main, sub, subOpacity = 1, scale = 1, dx = 0, dy = 0 }) {
  return logo.dots.map(
    (d) =>
      `<circle cx="${fmt(dx + d.cx * scale)}" cy="${fmt(dy + d.cy * scale)}" r="${fmt(logo.dotRadius * scale)}" fill="${d.tone === "main" ? main : sub}"${d.tone === "sub" && subOpacity !== 1 ? ` opacity="${subOpacity}"` : ""}/>`,
  ).join("\n  ");
}

export function markSvg(logo, main, sub, title) {
  title = escapeXml(title);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${logo.viewBox}" width="${logo.width * 4}" height="${logo.height * 4}" role="img" aria-label="${title}">
  <title>${title}</title>
  ${dots(logo, { main, sub })}
</svg>
`;
}

export function appIconSvg(logo, title) {
  title = escapeXml(title);
  const glyphW = TILE * GLYPH_SHARE;
  const scale = glyphW / logo.width;
  const dx = CANVAS / 2 - glyphW / 2;
  const dy = CANVAS / 2 - (logo.height * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}" role="img" aria-label="${title}">
  <title>${title}</title>
  <rect x="${INSET}" y="${INSET}" width="${TILE}" height="${TILE}" rx="${fmt(RADIUS)}" fill="${logo.accent}"/>
  ${dots(logo, { main: INK, sub: INK, subOpacity: 0.5, scale, dx, dy })}
</svg>
`;
}

// Night sky of nightly builds (same values as the --night-* design tokens).
const NIGHT = {
  top: "#0d1030", mid: "#1a1646", violet: "#8b5cf6", blue: "#3b6fe0", star: "#ffffff", moon: "#e9e4ff",
};

/** Deterministic stars for the nightly tile, kept clear of the glyph. */
function nightStars(glyph) {
  let state = 5;
  const next = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const stars = [];
  while (stars.length < 26) {
    const x = INSET + 30 + next() * (TILE - 60);
    const y = INSET + 30 + next() * (TILE - 60);
    const r = 2.5 + next() * 4.5;
    const opacity = 0.4 + next() * 0.6;
    const nearGlyph = x > glyph.x - 40 && x < glyph.x + glyph.w + 40 && y > glyph.y - 40 && y < glyph.y + glyph.h + 40;
    const nearMoon = Math.hypot(x - 760, y - 262) < 90;
    if (!nearGlyph && !nearMoon) stars.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(r)}" fill="${NIGHT.star}" opacity="${fmt(opacity)}"/>`);
  }
  return stars.join("\n    ");
}

/** App icon of nightly builds: the same glyph on a night sky with a moon. */
export function nightlyAppIconSvg(logo, title) {
  title = escapeXml(`${title} Nightly`);
  const glyphW = TILE * GLYPH_SHARE;
  const scale = glyphW / logo.width;
  const dx = CANVAS / 2 - glyphW / 2;
  const dy = CANVAS / 2 - (logo.height * scale) / 2;
  const glyph = { x: dx, y: dy, w: glyphW, h: logo.height * scale };
  const tile = `x="${INSET}" y="${INSET}" width="${TILE}" height="${TILE}" rx="${fmt(RADIUS)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}" role="img" aria-label="${title}">
  <title>${title}</title>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NIGHT.mid}"/><stop offset="1" stop-color="${NIGHT.top}"/></linearGradient>
    <radialGradient id="violet" cx="0.8" cy="0.12" r="0.75"><stop offset="0" stop-color="${NIGHT.violet}" stop-opacity="0.75"/><stop offset="1" stop-color="${NIGHT.violet}" stop-opacity="0"/></radialGradient>
    <radialGradient id="blue" cx="0.12" cy="0.9" r="0.65"><stop offset="0" stop-color="${NIGHT.blue}" stop-opacity="0.5"/><stop offset="1" stop-color="${NIGHT.blue}" stop-opacity="0"/></radialGradient>
    <clipPath id="tile"><rect ${tile}/></clipPath>
    <mask id="crescent"><rect width="${CANVAS}" height="${CANVAS}" fill="#fff"/><circle cx="738" cy="246" r="54" fill="#000"/></mask>
  </defs>
  <g clip-path="url(#tile)">
    <rect ${tile} fill="url(#sky)"/>
    <rect ${tile} fill="url(#violet)"/>
    <rect ${tile} fill="url(#blue)"/>
    ${nightStars(glyph)}
    <circle cx="764" cy="262" r="60" fill="${NIGHT.moon}" mask="url(#crescent)"/>
  </g>
  <rect x="${INSET + 2}" y="${INSET + 2}" width="${TILE - 4}" height="${TILE - 4}" rx="${fmt(RADIUS - 2)}" fill="none" stroke="${NIGHT.star}" stroke-opacity="0.14" stroke-width="4"/>
  ${dots(logo, { main: CHALK, sub: logo.accent, scale, dx, dy })}
</svg>
`;
}

export function findChrome() {
  if (process.env.CHROME) return existsSync(process.env.CHROME) ? process.env.CHROME : undefined;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return candidates.find((c) => existsSync(c));
}

/** Renders an SVG file to a square, transparent PNG of `size` px. */
async function renderPng(chrome, svgPath, outPath, size) {
  const tmp = mkdtempSync(join(tmpdir(), "agentz-logo-"));
  const html = join(tmp, "render.html");
  writeFileSync(
    html,
    `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${pathToFileURL(svgPath).href}">`,
  );
  try {
    // A dedicated profile avoids touching a running user browser. Some Chrome
    // versions keep background services alive after a screenshot, so completion
    // is the fully written PNG, not the browser's eventual process exit.
    rmSync(outPath, { force: true });
    await new Promise((resolveRender, rejectRender) => {
      const child = spawn(chrome, [
        "--headless=new",
        `--user-data-dir=${join(tmp, "profile")}`,
        "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        "--disable-background-networking", "--disable-extensions", "--hide-scrollbars",
        "--force-device-scale-factor=1", "--default-background-color=00000000",
        `--window-size=${size},${size}`, `--screenshot=${outPath}`, pathToFileURL(html).href,
      ], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      let captured = false;
      let failure;
      let forceKill;
      const complete = () => {
        try {
          const png = readFileSync(outPath);
          return png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
            && png.length >= 32 && png.readUInt32BE(16) === size && png.readUInt32BE(20) === size
            && png.subarray(-8).toString("hex") === "49454e44ae426082";
        } catch { return false; }
      };
      const poll = setInterval(() => {
        if (!captured && complete()) {
          captured = true;
          child.kill("SIGTERM");
          forceKill = setTimeout(() => child.kill("SIGKILL"), 2000);
        }
      }, 100);
      const timeout = setTimeout(() => {
        failure = new Error(`Chrome screenshot timed out: ${stderr}`);
        child.kill("SIGKILL");
      }, 30000);
      const cleanup = () => { clearInterval(poll); clearTimeout(timeout); clearTimeout(forceKill); };
      child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-8000); });
      child.on("error", (error) => { failure = error; });
      child.on("close", () => {
        cleanup();
        if (!failure && (captured || complete())) resolveRender();
        else rejectRender(failure ?? new Error(`Chrome did not produce a complete ${size}px PNG: ${stderr}`));
      });
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}

export const PLACEHOLDER_FILES = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.icns", "icon.ico"];
const placeholderDir = join(assetsDir, "placeholder");

/** Exported so generator tests can exercise fallback without writing real apps. */
export async function buildLogo({ appId, logo = LOGOS[appId], root = repoRoot, outputAssets = assetsDir, svgOnly = false, fallback = false, chrome = findChrome() }) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(appId)) throw new Error("Invalid app id");
  if (!logo) throw new Error(`No LOGOS entry for ${appId}`);
  const desktopDir = join(root, "apps", appId);
  if (appId !== "suite" && !existsSync(join(desktopDir, "src-tauri"))) {
    throw new Error(`App directory missing: apps/${appId}/src-tauri`);
  }
  mkdirSync(outputAssets, { recursive: true });
  // Product name from the app's Tauri config, so SVG titles match the app.
  const tauriConf = join(desktopDir, "src-tauri/tauri.conf.json");
  const productName = existsSync(tauriConf) ? JSON.parse(readFileSync(tauriConf, "utf8")).productName : undefined;
  const title = appId === "suite" ? "AgentZ" : productName || appId;
  const iconSvg = join(outputAssets, `${appId}-app-icon.svg`);
  writeFileSync(join(outputAssets, `${appId}-mark.svg`), markSvg(logo, INK, GRAPHITE, title));
  writeFileSync(join(outputAssets, `${appId}-mark-inverse.svg`), markSvg(logo, CHALK, logo.accent, title));
  writeFileSync(iconSvg, appIconSvg(logo, title));
  if (svgOnly) return { placeholder: false, svgOnly: true };

  const iconPng = join(outputAssets, `${appId}-app-icon.png`);
  const iconsDir = join(desktopDir, "src-tauri/icons");
  const siteImage = join(root, "apps/site/public/img", `${appId}.png`);
  mkdirSync(dirname(siteImage), { recursive: true });
  if (fallback || !chrome) {
    // Never borrow another product's branding silently. This checked-in set is
    // explicitly the suite placeholder; generated SVGs retain the real glyph.
    if (appId !== "suite") {
      mkdirSync(iconsDir, { recursive: true });
      for (const file of PLACEHOLDER_FILES) copyFileSync(join(placeholderDir, file), join(iconsDir, file));
      writeFileSync(join(iconsDir, "PLACEHOLDER.md"), `# Temporary suite icon\n\nChrome was unavailable or --fallback was selected. These are bundled AgentZ suite icons, not the ${appId} glyph. Regenerate with \`node packages/design/scripts/build-logo.mjs --app ${appId}\` once Chrome is installed.\n`);
    }
    copyFileSync(join(placeholderDir, "icon.png"), iconPng);
    copyFileSync(iconPng, siteImage);
    console.warn(`Using bundled AgentZ placeholder for ${appId}; install Chrome and rerun --app ${appId} for its own glyph.`);
    return { placeholder: true, svgOnly: false };
  }

  await renderPng(chrome, iconSvg, iconPng, CANVAS);
  copyFileSync(iconPng, siteImage);
  if (appId !== "suite") {
    // Explicit output avoids relying on a package-specific tauri npm script.
    execFileSync("pnpm", ["exec", "tauri", "icon", relative(desktopDir, iconPng), "--output", "src-tauri/icons"], {
      cwd: desktopDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    rmSync(join(iconsDir, "PLACEHOLDER.md"), { force: true });
    const iconset = join(iconsDir, "icon.iconset");
    mkdirSync(iconset, { recursive: true });
    for (const base of [16, 32, 128, 256, 512]) {
      for (const [suffix, px] of [["", base], ["@2x", base * 2]]) {
        await renderPng(chrome, iconSvg, join(iconset, `icon_${base}x${base}${suffix}.png`), px);
      }
    }
  }
  console.log(`Generated ${appId} design assets and ${appId === "suite" ? "website image" : "desktop/website icons"}.`);
  return { placeholder: false, svgOnly: false };
}

/** Night-sky icon set used by the nightly workflow (`tooling/release/nightly-config.mjs`). */
export async function buildNightlyIcons({ appId, logo = LOGOS[appId], root = repoRoot, outputAssets = assetsDir, chrome = findChrome() }) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(appId) || appId === "suite") throw new Error("Invalid app id");
  if (!logo) throw new Error(`No LOGOS entry for ${appId}`);
  const desktopDir = join(root, "apps", appId);
  if (!existsSync(join(desktopDir, "src-tauri"))) throw new Error(`App directory missing: apps/${appId}/src-tauri`);
  if (!chrome) throw new Error("Nightly icons need Chrome (set CHROME=/path/to/chrome).");
  const productName = JSON.parse(readFileSync(join(desktopDir, "src-tauri/tauri.conf.json"), "utf8")).productName || appId;
  mkdirSync(outputAssets, { recursive: true });
  const svg = join(outputAssets, `${appId}-app-icon-nightly.svg`);
  writeFileSync(svg, nightlyAppIconSvg(logo, productName));
  const tmp = mkdtempSync(join(tmpdir(), "agentz-nightly-icon-"));
  try {
    const png = join(tmp, "icon.png");
    await renderPng(chrome, svg, png, CANVAS);
    execFileSync("pnpm", ["exec", "tauri", "icon", png, "--output", join(tmp, "icons")], {
      cwd: desktopDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    const out = join(desktopDir, "src-tauri/icons-nightly");
    mkdirSync(out, { recursive: true });
    // Exactly the files a Tauri bundle uses (the same set as the placeholder).
    for (const file of PLACEHOLDER_FILES) copyFileSync(join(tmp, "icons", file), join(out, file));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`Generated ${appId} nightly icons.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let appId = "scriptz";
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--app") {
        appId = args[++i];
        if (!appId || appId.startsWith("--")) throw new Error("--app requires an app id");
      } else if (!["--svg-only", "--fallback", "--nightly"].includes(args[i])) throw new Error(`Unknown option: ${args[i]}`);
    }
    if (args.includes("--nightly")) await buildNightlyIcons({ appId });
    else await buildLogo({ appId, svgOnly: args.includes("--svg-only"), fallback: args.includes("--fallback") });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
