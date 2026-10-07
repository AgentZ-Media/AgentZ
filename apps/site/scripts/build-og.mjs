#!/usr/bin/env node
/** Renders the link preview images (Open Graph, 1200x630 JPEG) into public/og/:
 * the suite and ScriptZ, each in German and English. Texts come from
 * src/i18n.ts, colours from the design tokens. Needs Chrome (or CHROME=path).
 *
 * pnpm --filter @agentz/site build:og
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LOGO_DOTS, LOGO_DOT_R, LOGO_VIEWBOX } from "@agentz/design/logo";
import { catalogs } from "../src/i18n.ts";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(site, "public/og");
const design = (path) => import.meta.resolve(`@agentz/design/${path}`);
// The design package bundles Schibsted Grotesk through Fontsource.
const schibsted = pathToFileURL(createRequire(design("fonts.css"))
  .resolve("@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2")).href;
const W = 1200;
const H = 630;

const file = (path) => pathToFileURL(path).href;
const esc = (value) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((path) => existsSync(path));
}

const mark = (cls) => `<svg class="${cls}" viewBox="${LOGO_VIEWBOX}">${LOGO_DOTS
  .map((dot) => `<circle cx="${dot.cx}" cy="${dot.cy}" r="${LOGO_DOT_R}" class="${dot.tone}"/>`).join("")}</svg>`;

const style = `
@font-face { font-family: "Schibsted Grotesk Variable"; font-weight: 400 900; src: url("${schibsted}") format("woff2"); }
@font-face { font-family: "iA Writer Quattro"; font-weight: 400; src: url("${file(join(site, "src/assets/fonts/iAWriterQuattroS-Regular.woff2"))}") format("woff2"); }
@font-face { font-family: "iA Writer Quattro"; font-weight: 700; src: url("${file(join(site, "src/assets/fonts/iAWriterQuattroS-Bold.woff2"))}") format("woff2"); }
* { box-sizing: border-box; margin: 0; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
body { position: relative; font-family: var(--ui); color: var(--fg); -webkit-font-smoothing: antialiased;
  background: radial-gradient(circle at 78% 46%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 46%),
    radial-gradient(circle, var(--line) 1.7px, transparent 2px) 0 0 / 30px 30px, var(--side-bg); }
.copy { position: absolute; left: 76px; top: 72px; bottom: 64px; width: 640px; display: flex; flex-direction: column; }
.eyebrow { display: inline-flex; align-self: flex-start; align-items: center; gap: 12px; padding: 9px 18px 9px 14px; border-radius: 999px;
  font-size: 22px; font-weight: 550; color: var(--side-fg); background: var(--side-hover); box-shadow: inset 0 0 0 1.5px var(--line); }
.dot { width: 12px; height: 12px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 22%, transparent); }
h1 { margin-top: 34px; font-size: 104px; font-weight: 800; line-height: 0.94; letter-spacing: -0.055em; }
h1.long { font-size: 92px; }
h1 em { font-style: normal; color: var(--accent); text-shadow: 0 0 60px var(--accent-glow); }
.lead { margin-top: 26px; font-size: 30px; line-height: 1.3; color: var(--muted); }
.foot { margin-top: auto; display: flex; align-items: center; gap: 16px; font-size: 24px; color: var(--faint); }
.foot img { width: 52px; height: 52px; }
.foot b { color: var(--fg); font-weight: 700; }
.z { position: absolute; right: 92px; top: 108px; width: 344px; overflow: visible; }
.z circle { fill: var(--fg); }
.z circle.sub { fill: var(--muted); opacity: 0.62; }
.z circle:last-child { fill: var(--accent); filter: drop-shadow(0 0 18px var(--accent-glow)); }
.app { width: 104px; height: 104px; }
.copy.scriptz { width: 560px; }
.scriptz h1 { margin-top: 28px; font-size: 120px; }
.paper { position: absolute; right: 70px; top: 70px; width: 420px; height: 560px; padding: 44px 40px; border-radius: 14px;
  background: var(--paper); color: var(--paper-fg); box-shadow: var(--shadow-paper); rotate: 3deg;
  font-family: "iA Writer Quattro", monospace; font-size: 17px; line-height: 1.5; }
.paper .a { margin: 0 0 14px; }
.paper .c { margin: 0 0 2px 110px; font-weight: 700; letter-spacing: 0.04em; }
.paper .p { margin: 0 0 2px 84px; color: var(--paper-muted); }
.paper .d { margin: 0 0 14px 56px; }
.paper .c.c2 { color: var(--char-2); }
.paper .c.c1 { color: var(--char-1); }
.time { position: absolute; right: 44px; bottom: 54px; display: flex; align-items: baseline; gap: 10px; padding: 14px 22px; border-radius: 16px;
  background: var(--surface); box-shadow: var(--shadow-pop); color: var(--fg); font-size: 46px; font-weight: 800; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.time span { font-size: 20px; font-weight: 550; color: var(--muted); letter-spacing: 0; }
`;

function page(body, lang) {
  return `<!doctype html><html lang="${lang}" data-theme="dark"><head><meta charset="utf-8">
<link rel="stylesheet" href="${design("tokens.css")}">
<link rel="stylesheet" href="${file(join(site, "src/styles/palette.css"))}">
<style>${style}</style></head><body>${body}</body></html>`;
}

function suite(lang) {
  const t = catalogs[lang];
  return page(`
<div class="copy">
  <p class="eyebrow"><span class="dot"></span>${esc(t.hero.eyebrow)}</p>
  <h1${t.hero.titleA.length > 24 ? ' class="long"' : ""}>${esc(t.hero.titleA)} <em>${esc(t.hero.titleMark)}.</em></h1>
  <p class="foot"><img src="${design("assets/suite-app-icon.png")}"><b>AgentZ Suite</b>agentz-suite.com</p>
</div>
${mark("z")}`, lang);
}

function scriptz(lang) {
  const t = catalogs[lang];
  const names = [...new Set(t.demo.script.filter(([kind]) => kind === "c").map(([, text]) => text))];
  const lines = t.demo.script.slice(0, 8).map(([kind, text]) =>
    `<p class="${kind}${kind === "c" ? ` c${names.indexOf(text) + 1}` : ""}">${esc(text)}</p>`).join("");
  return page(`
<div class="copy scriptz">
  <img class="app" src="${design("assets/scriptz-app-icon.png")}">
  <h1>ScriptZ</h1>
  <p class="lead">${esc(t.scriptz.lead)}</p>
  <p class="foot">${esc(t.hero.facts)}</p>
</div>
<div class="paper">${lines}</div>
<p class="time">0:17<span>${esc(t.demo.length)}</span></p>`, lang);
}

async function render(chrome, html, target) {
  const tmp = mkdtempSync(join(tmpdir(), "agentz-og-"));
  const input = join(tmp, "og.html");
  writeFileSync(input, html);
  rmSync(target, { force: true });
  try {
    await new Promise((done, fail) => {
      const child = spawn(chrome, [
        "--headless=new", `--user-data-dir=${join(tmp, "profile")}`, "--disable-gpu", "--no-first-run",
        "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--allow-file-access-from-files",
        "--force-device-scale-factor=1", "--virtual-time-budget=4000",
        `--window-size=${W},${H}`, `--screenshot=${target}`, pathToFileURL(input).href,
      ], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      // Some Chrome versions linger after the screenshot; a complete JPEG
      // (start and end markers) is the signal.
      const written = () => {
        try {
          const jpeg = readFileSync(target);
          return jpeg.length > 1024 && jpeg.subarray(0, 2).toString("hex") === "ffd8"
            && jpeg.subarray(-2).toString("hex") === "ffd9";
        } catch { return false; }
      };
      const poll = setInterval(() => { if (written()) child.kill("SIGTERM"); }, 100);
      const timeout = setTimeout(() => child.kill("SIGKILL"), 30000);
      child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-4000); });
      child.on("close", () => {
        clearInterval(poll);
        clearTimeout(timeout);
        if (written()) done();
        else fail(new Error(`Chrome did not write ${target}: ${stderr}`));
      });
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const chrome = findChrome();
if (!chrome) throw new Error("Link preview images need Chrome (set CHROME=/path/to/chrome).");
mkdirSync(out, { recursive: true });
for (const lang of ["de", "en"]) {
  // JPEG keeps the images small enough for every messenger's preview.
  await render(chrome, suite(lang), join(out, `suite-${lang}.jpg`));
  await render(chrome, scriptz(lang), join(out, `scriptz-${lang}.jpg`));
  console.log(`og: suite-${lang}.jpg, scriptz-${lang}.jpg`);
}
