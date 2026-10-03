import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLogo, LOGOS, LOGO_DOTS } from "../logo.ts";
import { appIconSvg, buildLogo, markSvg, PLACEHOLDER_FILES } from "./build-logo.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "suite-icon-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "apps/example/src-tauri"), { recursive: true });
  return { root, outputAssets: join(root, "assets"), appId: "example", logo: createLogo("E") };
}

function pngSize(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("Chrome-less export supplies actual desktop formats and matching website image", async (t) => {
  const options = fixture(t);
  const result = await buildLogo({ ...options, chrome: null });
  assert.equal(result.placeholder, true);
  const icons = join(options.root, "apps/example/src-tauri/icons");
  for (const file of PLACEHOLDER_FILES) assert.ok(readFileSync(join(icons, file)).length > 0);
  for (const [file, size] of [["32x32.png", 32], ["128x128.png", 128], ["128x128@2x.png", 256]]) {
    assert.deepEqual(pngSize(readFileSync(join(icons, file))), [size, size]);
  }
  const icns = readFileSync(join(icons, "icon.icns"));
  assert.equal(icns.toString("ascii", 0, 4), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  const ico = readFileSync(join(icons, "icon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) > 0);
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const entry = 6 + i * 16;
    const size = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(size > 0 && offset + size <= ico.length);
  }
  const website = readFileSync(join(options.root, "apps/site/public/img/example.png"));
  assert.deepEqual(website, readFileSync(join(icons, "icon.png")));
  assert.deepEqual(website, readFileSync(join(options.outputAssets, "example-app-icon.png")));
  assert.match(readFileSync(join(icons, "PLACEHOLDER.md"), "utf8"), /not the example glyph/);
});

test("SVG exports use registered geometry, escape labels, and preserve ScriptZ", () => {
  assert.deepEqual(LOGOS.scriptz.dots, LOGO_DOTS);
  assert.notDeepEqual(createLogo("A").dots, createLogo("S").dots);
  assert.equal(createLogo("a").accent, "#ffe14d");
  assert.throws(() => createLogo("A", "red;url(bad)"), /hex colour/);
  const svg = markSvg(createLogo("S"), "currentColor", "currentColor", 'A & <B> "C"');
  assert.match(svg, /A &amp; &lt;B&gt; &quot;C&quot;/);
  assert.match(svg, /viewBox="0 0 50 70"/);
  const tile = appIconSvg(LOGOS.suite, "AgentZ");
  assert.match(tile, /<title>AgentZ<\/title>/);
  assert.match(tile, /<rect[^>]*fill="#ffe14d"/);
  assert.match(tile, /fill="#14161b" opacity="0.5"/);
  assert.doesNotMatch(tile, /linearGradient|#ffffff|#eceef1/);
});

test("invalid targets fail before writing and SVG-only does not need browser or icons", async (t) => {
  const options = fixture(t);
  for (const appId of ["../outside", "notes-", "notes--pro", "Notes", "-notes"]) {
    await assert.rejects(() => buildLogo({ ...options, appId }), /Invalid app id/);
  }
  await assert.rejects(() => buildLogo({ ...options, logo: null }), /No LOGOS entry/);
  await assert.rejects(() => buildLogo({ ...options, appId: "missing" }), /App directory missing/);
  assert.deepEqual(await buildLogo({ ...options, chrome: null, svgOnly: true }), { placeholder: false, svgOnly: true });
  assert.match(readFileSync(join(options.outputAssets, "example-mark.svg"), "utf8"), /<circle/);
});
