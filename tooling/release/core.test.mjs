import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTag, parseVersion, compareVersions, validateRelease, validateManifest, pointerDecision, renderBody, platformComplete, RELEASE_NOTES_PLACEHOLDER } from './core.mjs';
import { bump } from './bump.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'apps/notes/src-tauri'), { recursive: true });
  mkdirSync(join(root, 'docs/release-notes/notes'), { recursive: true });
  writeFileSync(join(root, 'apps/notes/package.json'), JSON.stringify({ name: '@agentz/notes-app', version: '0.1.0' }));
  writeFileSync(join(root, 'apps/notes/src-tauri/tauri.conf.json'), JSON.stringify({ productName: 'Notes App', version: '0.1.0' }));
  writeFileSync(join(root, 'apps/notes/src-tauri/Cargo.toml'), '[package]\nname = "notes"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"\n');
  writeFileSync(join(root, 'Cargo.lock'), 'version = 4\n\n[[package]]\nname = "notes"\nversion = "0.1.0"\n\n[[package]]\nname = "other"\nversion = "9.0.0"\n');
  writeFileSync(join(root, 'docs/release-notes/notes/v0.1.0.md'), 'Notes 0.1.0');
  return root;
}
const context = { version: '0.9.0', tag: 'scriptz-v0.9.0', repository: 'AgentZ-Media/AgentZ-Suite' };
function manifest(version = '0.9.0') {
  return { version, platforms: Object.fromEntries(['darwin-aarch64', 'windows-x86_64'].map(p => [p, { signature: 'signed', url: `https://github.com/AgentZ-Media/AgentZ-Suite/releases/download/scriptz-v${version}/${p}.tar.gz` }])) };
}
test('strict tags accept dashed app IDs and full semver, reject paths and old tags', () => {
  assert.deepEqual(parseTag('my-notes-v1.2.3-rc.2+build.7'), { app: 'my-notes', version: '1.2.3-rc.2+build.7' });
  for (const invalid of ['v1.2.3', '../scriptz-v1.2.3', 'ScriptZ-v1.2.3', '-v1.2.3', 'scriptz-v01.2.3', 'a-v1.2.3.4', 'a-v1.0.0-01', 'a-v1.0.0-']) assert.throws(() => parseTag(invalid));
  for (const valid of ['0.0.0', '1.2.3-0', '1.2.3-0a', '1.0.0+001']) assert.doesNotThrow(() => parseVersion(valid));
});
test('semver precedence including numeric prereleases, metadata and large numbers', () => {
  const versions = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.10.0', '2.0.0'];
  for (let i = 1; i < versions.length; i++) { assert.equal(compareVersions(versions[i], versions[i-1]), 1); assert.equal(compareVersions(versions[i-1], versions[i]), -1); }
  assert.equal(compareVersions('1.0.0+one', '1.0.0+two'), 0);
  assert.equal(compareVersions('999999999999999999999.0.0', '999999999999999999998.0.0'), 1);
});
test('prepare validates all four versions and requires app-specific notes', t => {
  const root = fixture(t);
  assert.equal(validateRelease(root, 'notes', '0.1.0').product, 'Notes App');
  const files = ['apps/notes/package.json', 'apps/notes/src-tauri/tauri.conf.json', 'apps/notes/src-tauri/Cargo.toml', 'Cargo.lock'];
  for (const file of files) { const path = join(root, file), original = readFileSync(path, 'utf8'); writeFileSync(path, original.replace('0.1.0', '0.1.1')); assert.throws(() => validateRelease(root, 'notes', '0.1.0'), /version/); writeFileSync(path, original); }
  rmSync(join(root, 'docs/release-notes/notes/v0.1.0.md'));
  assert.throws(() => validateRelease(root, 'notes', '0.1.0'), /Missing release notes/);
  assert.doesNotThrow(() => validateRelease(root, 'notes', '0.1.0', { notes: false }));
});
test('prepare rejects release notes that still contain the bump placeholder', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'docs/release-notes/notes/v0.1.0.md'), `Notes 0.1.0\n\n- ${RELEASE_NOTES_PLACEHOLDER}\n`);
  assert.throws(() => validateRelease(root, 'notes', '0.1.0'), /placeholder/);
  assert.doesNotThrow(() => validateRelease(root, 'notes', '0.1.0', { notes: false }));
});
test('bump updates only app version, invokes targeted offline Cargo update, creates notes', t => {
  const root = fixture(t);
  const result = bump(root, 'notes', '0.2.0', args => {
    assert.deepEqual(args, ['update', '--offline', '-p', 'notes', '--precise', '0.2.0']);
    const lock = join(root, 'Cargo.lock'); writeFileSync(lock, readFileSync(lock, 'utf8').replace('0.1.0', '0.2.0'));
  });
  assert.equal(result.tag, 'notes-v0.2.0');
  assert.equal(validateRelease(root, 'notes', '0.2.0', { notes: false }).lock, '0.2.0');
  // The generated notes are a template: releasing them unedited must fail.
  assert.throws(() => validateRelease(root, 'notes', '0.2.0'), /placeholder/);
  assert.match(readFileSync(result.notes, 'utf8'), /Notes App v0.2.0/);
  assert.match(readFileSync(join(root, 'Cargo.lock'), 'utf8'), /version = "9.0.0"/);
  assert.throws(() => bump(root, 'notes', '0.1.0'), /newer/);
});
test('failed Cargo update restores all original version files and creates no notes', t => {
  const root = fixture(t);
  assert.throws(() => bump(root, 'notes', '0.2.0', () => { writeFileSync(join(root, 'Cargo.lock'), 'broken'); throw new Error('offline'); }), /offline/);
  assert.equal(validateRelease(root, 'notes', '0.1.0').lock, '0.1.0');
  assert.throws(() => readFileSync(join(root, 'docs/release-notes/notes/v0.2.0.md')));
});
test('manifest requires both signatures and version-bound repository URLs', () => {
  assert.equal(validateManifest(manifest(), context).length, 2);
  for (const mutate of [m => { delete m.platforms['windows-x86_64']; }, m => { m.version = '0.8.4'; }, m => { m.platforms['darwin-aarch64'].signature = ' '; }, m => { m.platforms['darwin-aarch64'].url = 'https://evil.test/app.tar.gz'; }, m => { m.platforms['darwin-aarch64'].url = m.platforms['darwin-aarch64'].url.replace('scriptz-v0.9.0', 'scriptz-latest'); }, m => { m.platforms['darwin-aarch64'].url += '?token=secret'; }]) { const value = manifest(); mutate(value); assert.throws(() => validateManifest(value, context)); }
});
test('pointer cannot go backward, equal identical manifests repair partial uploads', () => {
  assert.equal(pointerDecision(manifest(), null), 'advance');
  assert.equal(pointerDecision(manifest(), manifest('0.8.4')), 'advance');
  assert.equal(pointerDecision(manifest(), manifest('0.10.0')), 'skip');
  assert.equal(pointerDecision(manifest(), manifest()), 'repair');
  const changed = manifest(); changed.platforms['darwin-aarch64'].signature = 'different';
  assert.throws(() => pointerDecision(changed, manifest()), /different manifest/);
  assert.equal(pointerDecision(manifest(), null, '0.10.0'), 'skip');
  assert.equal(pointerDecision(manifest(), manifest('0.8.4'), '0.10.0'), 'skip');
  assert.equal(pointerDecision(manifest(), null, '0.9.0'), 'advance');
});
test('pre-release versions never move the stable pointer', () => {
  assert.equal(pointerDecision(manifest('1.0.0-rc.1'), manifest('0.9.1')), 'prerelease');
  assert.equal(pointerDecision(manifest('1.0.0-rc.1'), null), 'prerelease');
  assert.equal(pointerDecision(manifest('1.0.0'), manifest('0.9.1')), 'advance');
});
test('install footer replaces all product placeholders', () => {
  assert.equal(renderBody('New notes\n', 'Open {{PRODUCT_NAME}}; {{PRODUCT_NAME}}.app', 'Notes App'), 'New notes\n\nOpen Notes App; Notes App.app\n');
});

test('completed platform retries preserve original signed artifacts', () => {
  const m = manifest();
  const assets = [{ name: 'darwin-aarch64.tar.gz' }, { name: 'ScriptZ_0.9.0_aarch64.dmg' }];
  assert.equal(platformComplete(m, assets, 'darwin-aarch64', context), true);
  assert.equal(platformComplete({ version: '0.9.0', platforms: {} }, [], 'windows-x86_64', context), false);
  assert.throws(() => platformComplete(m, [], 'darwin-aarch64', context), /missing assets/);
  assert.throws(() => platformComplete({ ...m, version: '0.8.4' }, assets, 'darwin-aarch64', context), /wrong version/);
});
test('manifest URL validation rejects traversal and accepts encoded SemVer metadata', () => {
  const m = manifest();
  m.platforms['darwin-aarch64'].url = 'https://github.com/AgentZ-Media/AgentZ-Suite/releases/download/scriptz-v0.9.0/../other/file';
  assert.throws(() => validateManifest(m, context));
  const tagged = manifest('0.9.0+build.7');
  for (const entry of Object.values(tagged.platforms)) entry.url = entry.url.replace('+', '%2B');
  assert.equal(validateManifest(tagged, { ...context, version: '0.9.0+build.7', tag: 'scriptz-v0.9.0+build.7' }).length, 2);
});
