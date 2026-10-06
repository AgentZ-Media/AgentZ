import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { appMetadata, compareVersions, validateAppId } from './core.mjs';
import { github, releaseByTag } from './github.mjs';
import { desktopApps, nightlyRelevant, nightlyTag, nightlyVersion, parseNightlyMarker } from './nightly.mjs';

// Decides which apps get a nightly build. Builds the newest commit on main
// whose required "CI passed" check succeeded, and only when that commit
// changed something the app is built from since its last nightly.
const root = process.cwd();
const repository = process.env.GITHUB_REPOSITORY;
const force = process.env.INPUT_FORCE === 'true';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const { api } = github(repository);
const output = (key, value) => appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);

function ciPassed(sha) {
  const runs = api(`commits/${sha}/check-runs?check_name=${encodeURIComponent('CI passed')}&filter=latest`).check_runs ?? [];
  return runs.some(run => run.status === 'completed' && run.conclusion === 'success');
}
const isAncestor = (ancestor, sha) => {
  try { execFileSync('git', ['merge-base', '--is-ancestor', ancestor, sha]); return true; }
  catch { return false; }
};

// Intermediate main commits often have a cancelled CI run; walk back a little.
const candidates = git('rev-list', '--first-parent', '--max-count=20', 'HEAD').split('\n');
const sha = candidates.find(ciPassed);
const builds = [];
if (!sha) {
  console.log('No recent commit on main with a successful "CI passed" check; nothing to build.');
} else {
  const now = new Date();
  const apps = process.env.INPUT_APP ? [validateAppId(process.env.INPUT_APP)] : desktopApps(root);
  for (const app of apps) {
    const meta = appMetadata(root, app);
    const marker = parseNightlyMarker(releaseByTag(api, nightlyTag(app))?.body);
    const previous = marker.commit && isAncestor(marker.commit, sha) ? marker.commit : '';
    if (!force && marker.commit === sha) { console.log(`${app}: ${sha.slice(0, 7)} already has a nightly.`); continue; }
    if (!force && previous) {
      const changed = git('diff', '--name-only', '--no-renames', `${previous}..${sha}`).split('\n');
      if (!nightlyRelevant(changed, app)) { console.log(`${app}: no app-relevant changes since ${previous.slice(0, 7)}.`); continue; }
    }
    const released = git('tag', '--list', `${app}-v${meta.config.version}`) !== '';
    const version = nightlyVersion(meta.config.version, released, now);
    if (marker.version && compareVersions(version, marker.version) <= 0) {
      console.log(`${app}: ${version} is not newer than the published ${marker.version}; skipping.`);
      continue;
    }
    builds.push({ app, product: meta.product, version, sha, previous, built_at: now.toISOString() });
    console.log(`${app}: building ${version} from ${sha.slice(0, 7)}.`);
  }
}
output('builds', JSON.stringify(builds));
output('any', String(builds.length > 0));
