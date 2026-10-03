import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseTag, validateRelease, validateManifest, pointerDecision } from './core.mjs';

const { app, version } = parseTag(process.env.RELEASE_TAG);
const repository = process.env.GITHUB_REPOSITORY;
const meta = validateRelease(process.cwd(), app, version);
const pointer = `${app}-latest`;
const gh = args => execFileSync('gh', [...args, '--repo', repository], { encoding: 'utf8' }).trim();
const api = path => JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${path}`], { encoding: 'utf8' }));
const dir = mkdtempSync(join(tmpdir(), 'agentz-pointer-'));
async function publicRequest(url, method = 'HEAD') {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, { method, signal: AbortSignal.timeout(30000) });
    if (response.ok) return response;
    if (attempt === 5) throw new Error(`Public asset unavailable (${response.status}): ${url}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
try {
  const release = api(`releases/tags/${meta.tag}`);
  if (release.draft) throw new Error('Source release must be published');
  gh(['release', 'download', meta.tag, '--pattern', 'latest.json', '--dir', dir]);
  const candidateText = readFileSync(join(dir, 'latest.json'), 'utf8');
  const candidate = JSON.parse(candidateText);
  const urls = validateManifest(candidate, { version, tag: meta.tag, repository });
  for (const url of urls) await publicRequest(url);
  const select = suffix => {
    const assets = release.assets.filter(asset => asset.name.endsWith(suffix));
    if (assets.length !== 1) throw new Error(`Expected one ${suffix} installer, found ${assets.length}`);
    return assets[0];
  };
  const installers = [[select('_aarch64.dmg'), `${app}-macos-arm64.dmg`], [select('_x64-setup.exe'), `${app}-windows-x64-setup.exe`]];
  for (const [asset, stable] of installers) {
    await publicRequest(asset.browser_download_url);
    gh(['release', 'download', meta.tag, '--pattern', asset.name, '--dir', dir]);
    copyFileSync(join(dir, asset.name), join(dir, stable));
  }
  let currentRelease;
  try { currentRelease = api(`releases/tags/${pointer}`); }
  catch (error) { if (!String(error.stderr).includes('HTTP 404')) throw error; }
  let current = null;
  if (currentRelease) {
    if (currentRelease.draft || !currentRelease.prerelease) throw new Error('Pointer must be a published prerelease');
    const manifest = currentRelease.assets.find(asset => asset.name === 'latest.json');
    if (manifest) {
      // Read the authoritative asset through GitHub, not a possibly cached public redirect.
      const currentDir = mkdtempSync(join(dir, 'current-'));
      gh(['release', 'download', pointer, '--pattern', 'latest.json', '--dir', currentDir]);
      current = JSON.parse(readFileSync(join(currentDir, 'latest.json'), 'utf8'));
    }
  }
  const reservedVersion = currentRelease?.body?.match(/<!-- agentz-pointer-version: ([^ ]+) -->/)?.[1];
  if (currentRelease && !current && !reservedVersion) throw new Error('Pointer has no manifest or recovery version marker; refusing an unverified rollback');
  const decision = pointerDecision(candidate, current, reservedVersion);
  if (decision === 'skip') {
    console.log(`Pointer already has newer version ${current?.version ?? reservedVersion}; leaving it untouched.`);
  } else {
    const body = join(dir, 'pointer-body.md');
    writeFileSync(body, `Always the current version of ${meta.product}: **${version}**.\n\n<!-- agentz-pointer-version: ${version} -->\n\n[Release notes](https://github.com/${repository}/releases/tag/${meta.tag})\n`);
    if (!currentRelease) gh(['release', 'create', pointer, '--target', process.env.GITHUB_SHA, '--prerelease', '--latest=false', '--title', `${meta.product} — current downloads`, '--notes-file', body]);
    else gh(['release', 'edit', pointer, '--prerelease', '--latest=false', '--notes-file', body]);
    // Reserve the version in the body before any destructive asset replacement.
    // Even if --clobber deletes the manifest then fails, an older rerun cannot roll back.
    // Installers first, manifest last. Retrying the same manifest repairs partial uploads.
    for (const [, stable] of installers) gh(['release', 'upload', pointer, join(dir, stable), '--clobber']);
    gh(['release', 'upload', pointer, join(dir, 'latest.json'), '--clobber']);
    gh(['release', 'edit', pointer, '--prerelease', '--latest=false', '--notes-file', body]);
    for (const name of ['latest.json', ...installers.map(([, stable]) => stable)]) {
      await publicRequest(`https://github.com/${repository}/releases/download/${pointer}/${name}`);
    }
    console.log(`${pointer} ${decision}: ${version}; public manifest and installers reachable without authentication.`);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
