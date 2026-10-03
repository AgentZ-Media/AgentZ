import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
export function parseVersion(value) {
  const match = typeof value === 'string' && value.match(semver);
  if (!match) throw new Error(`Invalid semantic version: ${value}`);
  return { core: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') ?? [] };
}
export function compareVersions(a, b) {
  const aa = parseVersion(a), bb = parseVersion(b);
  for (let i = 0; i < 3; i++) if (aa.core[i] !== bb.core[i]) return aa.core[i] > bb.core[i] ? 1 : -1;
  if (!aa.pre.length || !bb.pre.length) return aa.pre.length === bb.pre.length ? 0 : aa.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(aa.pre.length, bb.pre.length); i++) {
    const x = aa.pre[i], y = bb.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
export function validateAppId(app) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(app)) throw new Error(`Invalid app ID: ${app}`);
  return app;
}
export function parseTag(tag) {
  const match = /^(.*)-v(.+)$/.exec(tag);
  if (!match) throw new Error(`Expected <app-id>-v<semver>: ${tag}`);
  return { app: validateAppId(match[1]), version: (parseVersion(match[2]), match[2]) };
}
export function tomlPackage(source) {
  const section = source.match(/^\[package\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  const name = section?.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  const version = section?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!name || !version) throw new Error('Expected explicit [package] name and version in Cargo.toml');
  return { name, version };
}
export function lockPackage(source, name) {
  const matches = source.split(/^\[\[package\]\]\s*$/m).filter(block => new RegExp(`^name = "${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"$`, 'm').test(block));
  if (matches.length !== 1) throw new Error(`Expected exactly one Cargo.lock package ${name}`);
  if (/^source\s*=/m.test(matches[0])) throw new Error(`Expected local Cargo.lock package ${name}`);
  return matches[0].match(/^version = "([^"]+)"$/m)?.[1];
}
export function appMetadata(root, app) {
  validateAppId(app);
  const base = join(root, 'apps', app);
  const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'));
  const config = JSON.parse(readFileSync(join(base, 'src-tauri/tauri.conf.json'), 'utf8'));
  const cargoText = readFileSync(join(base, 'src-tauri/Cargo.toml'), 'utf8');
  const cargo = tomlPackage(cargoText);
  const lock = lockPackage(readFileSync(join(root, 'Cargo.lock'), 'utf8'), cargo.name);
  return { app, base, pkg, config, cargoText, cargo, lock, product: config.productName };
}
export function validateRelease(root, app, version, { notes = true } = {}) {
  parseVersion(version);
  const meta = appMetadata(root, app);
  for (const [file, actual] of Object.entries({ 'package.json': meta.pkg.version, 'tauri.conf.json': meta.config.version, 'Cargo.toml': meta.cargo.version, 'Cargo.lock': meta.lock })) {
    if (actual !== version) throw new Error(`${app}: ${file} version ${actual} != ${version}`);
  }
  if (typeof meta.product !== 'string' || !meta.product.trim() || /[\r\n]/.test(meta.product)) throw new Error('Invalid productName');
  const notesFile = join(root, 'docs/release-notes', app, `v${version}.md`);
  if (notes && (!existsSync(notesFile) || !readFileSync(notesFile, 'utf8').trim())) throw new Error(`Missing release notes: ${notesFile}`);
  return { ...meta, version, tag: `${app}-v${version}`, notesFile };
}
export function renderBody(notes, footer, product) {
  return `${notes.trim()}\n\n${footer.replaceAll('{{PRODUCT_NAME}}', product).trim()}\n`;
}
export function validatePlatform(entry, platform, { tag, repository }) {
  if (!entry || typeof entry.signature !== 'string' || !entry.signature.trim()) throw new Error(`Missing signature/platform: ${platform}`);
  const url = new URL(entry.url);
  const parts = url.pathname.split('/');
  const [owner, repo] = repository.split('/');
  if (url.origin !== 'https://github.com' || url.search || url.hash || url.username || url.password
    || parts.length !== 7 || parts[1] !== owner || parts[2] !== repo || parts[3] !== 'releases'
    || parts[4] !== 'download' || decodeURIComponent(parts[5]) !== tag || !parts[6]
    || /[/\\]/.test(decodeURIComponent(parts[6]))) throw new Error(`Unexpected updater URL: ${entry.url}`);
  return entry.url;
}
export function validateManifest(manifest, context) {
  if (manifest.version !== context.version) throw new Error('Updater manifest version does not match tag');
  parseVersion(manifest.version);
  return ['darwin-aarch64', 'windows-x86_64'].map(platform => validatePlatform(manifest.platforms?.[platform], platform, context));
}
export function platformComplete(manifest, assets, platform, context) {
  if (!manifest?.platforms?.[platform]) return false;
  if (manifest.version !== context.version) throw new Error('Existing manifest has wrong version');
  const url = validatePlatform(manifest.platforms[platform], platform, context);
  const updaterName = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
  const suffix = platform === 'darwin-aarch64' ? '_aarch64.dmg' : '_x64-setup.exe';
  if (!assets.some(asset => asset.name === updaterName) || assets.filter(asset => asset.name.endsWith(suffix)).length !== 1) {
    throw new Error('Completed platform is missing assets; refusing to rebuild signed release files');
  }
  return true;
}
export function pointerDecision(candidate, current, reservedVersion = null) {
  if (reservedVersion && compareVersions(candidate.version, reservedVersion) < 0) return 'skip';
  if (!current) return 'advance';
  const order = compareVersions(candidate.version, current.version);
  if (order < 0) return 'skip';
  if (order > 0) return 'advance';
  // A rerun may repair interrupted installer uploads, but cannot replace a version.
  if (JSON.stringify(candidate) !== JSON.stringify(current)) throw new Error('Equal version has a different manifest; refusing to overwrite pointer');
  return 'repair';
}
