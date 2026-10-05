import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, parseVersion, validateAppId, validatePlatform } from './core.mjs';

// Nightly builds: prereleases of the next version, published to the rolling
// pre-release `<app>-nightly`. Pure helpers; the scripts do the I/O.

/** How many nightly versions keep their assets in the rolling release. */
export const NIGHTLY_KEEP_VERSIONS = 3;
const MARKER = /<!-- agentz-nightly-(commit|version): ([^ ]+) -->/g;

export const nightlyTag = app => `${validateAppId(app)}-nightly`;

/** Apps with a desktop shell (`apps/<id>/src-tauri/tauri.conf.json`). */
export function desktopApps(root) {
  return readdirSync(join(root, 'apps'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(root, 'apps', entry.name, 'src-tauri/tauri.conf.json')))
    .map(entry => validateAppId(entry.name))
    .sort();
}

/** `0.10.0` already released -> `0.10.1-nightly.202610051500`; an unreleased
 * prepared version (`0.11.0`) stays the base, so its release supersedes it. */
export function nightlyVersion(configVersion, released, date) {
  const { core } = parseVersion(configVersion);
  const [major, minor, patch] = core;
  const base = released ? `${major}.${minor}.${patch + 1n}` : `${major}.${minor}.${patch}`;
  const stamp = date.toISOString().slice(0, 16).replace(/[-T:]/g, '');
  if (!/^\d{12}$/.test(stamp)) throw new Error(`Invalid build time: ${date.toISOString()}`);
  return `${base}-nightly.${stamp}`;
}

export function isNightlyVersion(version) {
  return /^\d+\.\d+\.\d+-nightly\.\d{12}$/.test(version);
}

/** Whether a change set can alter the app's nightly build. */
export function nightlyRelevant(paths, app) {
  validateAppId(app);
  const shared = new Set(['Cargo.toml', 'Cargo.lock', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json']);
  return paths.some(path => path && !path.endsWith('.md') && (shared.has(path)
    || path.startsWith(`apps/${app}/`) || path.startsWith(`modules/${app}/`)
    || path.startsWith('packages/') || path.startsWith('crates/')));
}

/** Commit and version of the last published nightly, from the release body. */
export function parseNightlyMarker(body) {
  const marker = {};
  for (const [, key, value] of String(body ?? '').matchAll(MARKER)) marker[key] = value;
  return marker;
}

export function nightlyMarker(commit, version) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Expected a full commit SHA: ${commit}`);
  if (!isNightlyVersion(version)) throw new Error(`Expected a nightly version: ${version}`);
  return `<!-- agentz-nightly-commit: ${commit} -->\n<!-- agentz-nightly-version: ${version} -->`;
}

/** GitHub asset names stay ASCII without spaces. */
export function assetBase(product) {
  const base = product.trim().replace(/[^A-Za-z0-9._-]+/g, '.').replace(/^\.+|\.+$/g, '');
  if (!base) throw new Error(`Product name has no usable characters: ${product}`);
  return base;
}

export function nightlyAssetNames(app, product, version) {
  const base = `${assetBase(product)}_${version}`;
  return {
    macUpdater: `${base}_aarch64.app.tar.gz`,
    macInstaller: `${base}_aarch64.dmg`,
    windowsInstaller: `${base}_x64-setup.exe`,
    macDownload: `${app}-nightly-macos-arm64.dmg`,
    windowsDownload: `${app}-nightly-windows-x64-setup.exe`,
  };
}

export function nightlyManifest({ app, product, version, repository, pubDate, notes, macSignature, windowsSignature }) {
  if (!isNightlyVersion(version)) throw new Error(`Expected a nightly version: ${version}`);
  const names = nightlyAssetNames(app, product, version);
  const url = name => `https://github.com/${repository}/releases/download/${nightlyTag(app)}/${encodeURIComponent(name)}`;
  const mac = { signature: macSignature.trim(), url: url(names.macUpdater) };
  const windows = { signature: windowsSignature.trim(), url: url(names.windowsInstaller) };
  const manifest = {
    version, notes, pub_date: pubDate,
    platforms: { 'darwin-aarch64': mac, 'darwin-aarch64-app': mac, 'windows-x86_64': windows, 'windows-x86_64-nsis': windows },
  };
  for (const platform of Object.keys(manifest.platforms)) {
    validatePlatform(manifest.platforms[platform], platform, { tag: nightlyTag(app), repository });
  }
  return manifest;
}

/** Versioned assets of all but the newest `keep` nightly versions. Stable
 * download names and the manifest are never pruned. */
export function nightlyAssetsToPrune(assets, product, keep = NIGHTLY_KEEP_VERSIONS) {
  const prefix = `${assetBase(product)}_`;
  const versionOf = name => {
    if (!name.startsWith(prefix)) return null;
    const match = /^(.+)_(?:aarch64\.app\.tar\.gz|aarch64\.dmg|x64-setup\.exe)$/.exec(name.slice(prefix.length));
    return match && isNightlyVersion(match[1]) ? match[1] : null;
  };
  const versions = [...new Set(assets.map(asset => versionOf(asset.name)).filter(Boolean))]
    .sort((a, b) => compareVersions(b, a));
  const kept = new Set(versions.slice(0, keep));
  return assets.filter(asset => {
    const version = versionOf(asset.name);
    return version !== null && !kept.has(version);
  });
}

export function renderNightlyBody({ app, product, version, commit, builtAt, repository, changes, footer }) {
  const short = commit.slice(0, 7);
  const download = name => `https://github.com/${repository}/releases/download/${nightlyTag(app)}/${name}`;
  const names = nightlyAssetNames(app, product, version);
  const list = changes.length ? changes.map(change => `- ${change.subject} (${change.sha.slice(0, 7)})`).join('\n') : '- No code changes listed.';
  return `Nightly build of **${product}** \`${version}\` from [\`${short}\`](https://github.com/${repository}/commit/${commit}) on \`main\`, built ${builtAt.replace('T', ' ').slice(0, 16)} UTC.

**Untested preview.** Turn it on in ${product} under *Settings → Updates → Get nightly builds*, or download it directly:

- macOS (Apple Silicon): [${names.macDownload}](${download(names.macDownload)})
- Windows (x64): [${names.windowsDownload}](${download(names.windowsDownload)})

### Changes since the previous nightly

${list}

${footer.replaceAll('{{PRODUCT_NAME}}', product).trim()}

${nightlyMarker(commit, version)}
`;
}
