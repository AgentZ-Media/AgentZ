import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { compareVersions } from './core.mjs';
import {
  desktopApps, isNightlyVersion, nightlyAssetNames, nightlyAssetsToPrune, nightlyManifest, nightlyMarker,
  nightlyRelevant, nightlyVersion, parseNightlyMarker, renderNightlyBody,
} from './nightly.mjs';

const at = new Date('2026-10-05T15:04:09.123Z');
const sha = 'a'.repeat(40);
const repository = 'AgentZ-Media/AgentZ-Suite';

test('nightly versions sit between the released and the next stable version', () => {
  const released = nightlyVersion('0.10.0', true, at);
  assert.equal(released, '0.10.1-nightly.202610051504');
  assert.equal(compareVersions(released, '0.10.0'), 1);
  assert.equal(compareVersions(released, '0.10.1'), -1);
  // A prepared but untagged release stays the base, so tagging it supersedes nightlies.
  const prepared = nightlyVersion('0.11.0', false, at);
  assert.equal(prepared, '0.11.0-nightly.202610051504');
  assert.equal(compareVersions(prepared, '0.11.0'), -1);
  assert.equal(compareVersions(nightlyVersion('0.10.0', true, new Date('2026-10-05T18:00:00Z')), released), 1);
  assert.ok(isNightlyVersion(released));
  for (const other of ['0.10.1', '0.10.1-rc.1', '0.10.1-nightly.1', 'v0.10.1-nightly.202610051504']) assert.equal(isNightlyVersion(other), false);
});

test('only changes that feed the app build trigger a nightly', () => {
  for (const path of ['apps/scriptz/src-tauri/tauri.conf.json', 'modules/scriptz/lib/db.ts', 'packages/kit/shell/Shell.css', 'crates/agentz-desktop/src/lib.rs', 'Cargo.lock', 'pnpm-lock.yaml']) {
    assert.equal(nightlyRelevant([path], 'scriptz'), true, path);
  }
  for (const path of ['docs/release-notes/scriptz/v0.10.0.md', 'apps/site/src/apps.ts', 'modules/notes/index.ts', 'packages/kit/README.md', '.github/workflows/ci.yml', 'tooling/release/core.mjs', '']) {
    assert.equal(nightlyRelevant([path], 'scriptz'), false, path);
  }
});

test('the release text marker round-trips commit and version', () => {
  const marker = nightlyMarker(sha, '0.10.1-nightly.202610051504');
  assert.deepEqual(parseNightlyMarker(`Notes\n\n${marker}\n`), { commit: sha, version: '0.10.1-nightly.202610051504' });
  assert.deepEqual(parseNightlyMarker(null), {});
  assert.throws(() => nightlyMarker('abc1234', '0.10.1-nightly.202610051504'));
  assert.throws(() => nightlyMarker(sha, '0.10.1'));
});

test('the manifest points to versioned assets of the nightly release only', () => {
  const version = '0.10.1-nightly.202610051504';
  const manifest = nightlyManifest({ app: 'scriptz', product: 'ScriptZ', version, repository, pubDate: at.toISOString(), notes: 'n', macSignature: 'mac\n', windowsSignature: 'win\n' });
  assert.equal(manifest.version, version);
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ['darwin-aarch64', 'darwin-aarch64-app', 'windows-x86_64', 'windows-x86_64-nsis']);
  assert.equal(manifest.platforms['darwin-aarch64'].signature, 'mac');
  assert.equal(manifest.platforms['darwin-aarch64'].url, `https://github.com/${repository}/releases/download/scriptz-nightly/ScriptZ_${version}_aarch64.app.tar.gz`);
  assert.equal(manifest.platforms['windows-x86_64'].url, `https://github.com/${repository}/releases/download/scriptz-nightly/ScriptZ_${version}_x64-setup.exe`);
  assert.throws(() => nightlyManifest({ app: 'scriptz', product: 'ScriptZ', version: '0.10.1', repository, pubDate: '', notes: '', macSignature: 'a', windowsSignature: 'b' }));
  assert.throws(() => nightlyManifest({ app: 'scriptz', product: 'ScriptZ', version, repository, pubDate: '', notes: '', macSignature: ' ', windowsSignature: 'b' }), /signature/i);
});

test('pruning keeps the newest nightly versions and every unversioned asset', () => {
  const versions = ['0.10.1-nightly.202610050300', '0.10.1-nightly.202610050600', '0.10.1-nightly.202610050900', '0.10.1-nightly.202610051200'];
  const assets = versions.flatMap(version => Object.values(nightlyAssetNames('scriptz', 'ScriptZ', version)).slice(0, 3))
    .concat(['latest.json', 'scriptz-nightly-macos-arm64.dmg', 'scriptz-nightly-windows-x64-setup.exe', 'ScriptZ_notes.txt'])
    .map((name, id) => ({ id, name }));
  const pruned = nightlyAssetsToPrune(assets, 'ScriptZ', 3).map(asset => asset.name);
  assert.deepEqual(pruned, Object.values(nightlyAssetNames('scriptz', 'ScriptZ', versions[0])).slice(0, 3));
});

test('asset names are safe for products with spaces', () => {
  assert.equal(nightlyAssetNames('notes', 'Notes App', '0.1.1-nightly.202610051504').macInstaller, 'Notes.App_0.1.1-nightly.202610051504_aarch64.dmg');
});

test('the release text lists changes, downloads, the footer and the marker', () => {
  const version = '0.10.1-nightly.202610051504';
  const body = renderNightlyBody({ app: 'scriptz', product: 'ScriptZ', version, commit: sha, builtAt: at.toISOString(), repository,
    changes: [{ sha: 'b'.repeat(40), subject: 'Sternenhimmel' }], footer: 'Install {{PRODUCT_NAME}}' });
  assert.match(body, /- Sternenhimmel \(bbbbbbb\)/);
  assert.match(body, /scriptz-nightly-macos-arm64\.dmg\]\(https:\/\/github\.com\/AgentZ-Media\/AgentZ-Suite\/releases\/download\/scriptz-nightly\/scriptz-nightly-macos-arm64\.dmg\)/);
  assert.match(body, /Install ScriptZ/);
  assert.deepEqual(parseNightlyMarker(body), { commit: sha, version });
});

test('desktop apps are the app shells with a Tauri config', t => {
  const root = mkdtempSync(join(tmpdir(), 'nightly-apps-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const app of ['scriptz', 'notes']) { mkdirSync(join(root, 'apps', app, 'src-tauri'), { recursive: true }); writeFileSync(join(root, 'apps', app, 'src-tauri/tauri.conf.json'), '{}'); }
  mkdirSync(join(root, 'apps/site/src'), { recursive: true });
  assert.deepEqual(desktopApps(root), ['notes', 'scriptz']);
});

test('the build config overrides the version and switches to complete nightly icons', t => {
  const root = mkdtempSync(join(tmpdir(), 'nightly-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tauri = join(root, 'apps/notes/src-tauri');
  mkdirSync(join(tauri, 'icons'), { recursive: true });
  writeFileSync(join(tauri, 'tauri.conf.json'), JSON.stringify({ bundle: { icon: ['icons/32x32.png', 'icons/icon.icns'] } }));
  const script = fileURLToPath(new URL('./nightly-config.mjs', import.meta.url));
  const run = () => {
    execFileSync(process.execPath, [script, 'notes', '0.1.1-nightly.202610051504', join(root, 'out.json')], { cwd: root, stdio: 'pipe' });
    return JSON.parse(readFileSync(join(root, 'out.json'), 'utf8'));
  };
  assert.deepEqual(run(), { version: '0.1.1-nightly.202610051504' });
  mkdirSync(join(tauri, 'icons-nightly'));
  writeFileSync(join(tauri, 'icons-nightly/32x32.png'), '');
  assert.deepEqual(run(), { version: '0.1.1-nightly.202610051504' });
  writeFileSync(join(tauri, 'icons-nightly/icon.icns'), '');
  assert.deepEqual(run(), { version: '0.1.1-nightly.202610051504', bundle: { icon: ['icons-nightly/32x32.png', 'icons-nightly/icon.icns'] } });
  assert.throws(() => execFileSync(process.execPath, [script, 'notes', '0.1.1', join(root, 'out.json')], { cwd: root, stdio: 'pipe' }));
});
