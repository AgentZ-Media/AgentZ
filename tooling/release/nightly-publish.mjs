import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { appMetadata, compareVersions, validateAppId } from './core.mjs';
import { github, publicRequest, releaseByTag } from './github.mjs';
import {
  isNightlyVersion, nightlyAssetNames, nightlyAssetsToPrune, nightlyManifest, nightlyTag, renderNightlyBody,
} from './nightly.mjs';

// Publishes one signed nightly build into the rolling pre-release
// `<app>-nightly`: versioned assets first, then the stable download names,
// `latest.json` last, then the release text with the commit marker.
const root = process.cwd();
const repository = process.env.GITHUB_REPOSITORY;
const app = validateAppId(process.env.APP);
const { VERSION: version, SHA: sha, PREVIOUS: previous = '', BUILT_AT: builtAt, ARTIFACTS: artifacts } = process.env;
if (!isNightlyVersion(version)) throw new Error(`Expected a nightly version: ${version}`);
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Expected a full commit SHA: ${sha}`);
if (Number.isNaN(Date.parse(builtAt))) throw new Error(`Invalid build time: ${builtAt}`);

const tag = nightlyTag(app);
const { product } = appMetadata(root, app);
const names = nightlyAssetNames(app, product, version);
const { gh, api } = github(repository);
const dir = mkdtempSync(join(tmpdir(), 'agentz-nightly-'));

function files(path) {
  return readdirSync(path).flatMap(name => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}
const built = files(artifacts);
function one(suffix, mustContainVersion) {
  const matches = built.filter(path => path.endsWith(suffix));
  if (matches.length !== 1) throw new Error(`Expected one *${suffix} build artifact, found ${matches.length}`);
  // Proves the version override reached the bundle (installers carry it in their name).
  if (mustContainVersion && !matches[0].includes(`_${version}_`)) throw new Error(`Artifact ${matches[0]} is not version ${version}`);
  return matches[0];
}
function changesSince() {
  const range = previous ? `${previous}..${sha}` : sha;
  const limit = previous ? 50 : 20;
  const log = execFileSync('git', ['log', '--no-merges', `--max-count=${limit}`, '--format=%H%x09%s', range], { encoding: 'utf8' }).trim();
  return log ? log.split('\n').map(line => { const [full, ...subject] = line.split('\t'); return { sha: full, subject: subject.join('\t') }; }) : [];
}

async function publish() {
  const macUpdater = one('.app.tar.gz', false);
  const macSignature = readFileSync(one('.app.tar.gz.sig', false), 'utf8');
  const macInstaller = one('.dmg', true);
  const windowsInstaller = one('-setup.exe', true);
  const windowsSignature = readFileSync(one('-setup.exe.sig', true), 'utf8');

  const release = releaseByTag(api, tag);
  if (release && (release.draft || !release.prerelease)) throw new Error(`${tag} must be a published pre-release`);
  if (release?.assets.some(asset => asset.name === 'latest.json')) {
    const current = mkdtempSync(join(dir, 'current-'));
    gh(['release', 'download', tag, '--pattern', 'latest.json', '--dir', current]);
    const published = JSON.parse(readFileSync(join(current, 'latest.json'), 'utf8')).version;
    // Never roll the channel back, e.g. when an older run is re-run.
    if (compareVersions(version, published) <= 0) {
      console.log(`${tag} already serves ${published}; ${version} is not newer. Nothing published.`);
      return;
    }
  }

  const body = join(dir, 'body.md');
  writeFileSync(body, renderNightlyBody({
    app, product, version, commit: sha, builtAt, repository, changes: changesSince(),
    footer: readFileSync(join(root, 'docs/release-notes/_install_footer.md'), 'utf8'),
  }));
  if (!release) {
    // The tag only names the channel; the release text records the built commit.
    gh(['release', 'create', tag, '--target', sha, '--prerelease', '--latest=false', '--title', `${product} Nightly`, '--notes-file', body]);
  }

  const staged = [[macUpdater, names.macUpdater], [macInstaller, names.macInstaller], [windowsInstaller, names.windowsInstaller]]
    .map(([source, name]) => { copyFileSync(source, join(dir, name)); return join(dir, name); });
  gh(['release', 'upload', tag, ...staged, '--clobber']);

  const manifest = nightlyManifest({
    app, product, version, repository, pubDate: builtAt,
    notes: `Nightly build of ${product} from ${sha.slice(0, 7)}.`, macSignature, windowsSignature,
  });
  for (const platform of ['darwin-aarch64', 'windows-x86_64']) await publicRequest(manifest.platforms[platform].url);

  copyFileSync(macInstaller, join(dir, names.macDownload));
  copyFileSync(windowsInstaller, join(dir, names.windowsDownload));
  gh(['release', 'upload', tag, join(dir, names.macDownload), join(dir, names.windowsDownload), '--clobber']);
  writeFileSync(join(dir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  gh(['release', 'upload', tag, join(dir, 'latest.json'), '--clobber']);
  // The marker moves only after the manifest is live, so a failed upload is retried next time.
  gh(['release', 'edit', tag, '--prerelease', '--latest=false', '--notes-file', body]);
  await publicRequest(`https://github.com/${repository}/releases/download/${tag}/latest.json`);

  const assets = api(`releases/tags/${tag}`).assets;
  for (const asset of nightlyAssetsToPrune(assets, product)) {
    api(`releases/assets/${asset.id}`, 'DELETE');
    console.log(`Pruned ${asset.name}`);
  }
  console.log(`${tag}: published ${version} from ${sha.slice(0, 7)}.`);
}

try { await publish(); }
finally { rmSync(dir, { recursive: true, force: true }); }
