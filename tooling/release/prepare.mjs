import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseTag, appMetadata, validateAppId, validateRelease, renderBody, parseVersion } from './core.mjs';

const root = process.cwd();
const dry = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
const selection = dry
  ? { app: validateAppId(process.env.INPUT_APP), version: appMetadata(root, process.env.INPUT_APP).pkg.version }
  : parseTag(process.env.GITHUB_REF_NAME);
const meta = validateRelease(root, selection.app, selection.version, { notes: !dry });
const output = { app_id: meta.app, version: meta.version, tag: meta.tag, dry_run: String(dry) };
if (!dry) {
  const repository = process.env.GITHUB_REPOSITORY;
  const gh = args => execFileSync('gh', [...args, '--repo', repository], { encoding: 'utf8' }).trim();
  const prerelease = parseVersion(meta.version).pre.length > 0;
  const body = join(process.env.RUNNER_TEMP, 'release-body.md');
  writeFileSync(body, renderBody(readFileSync(meta.notesFile, 'utf8'), readFileSync(join(root, 'docs/release-notes/_install_footer.md'), 'utf8'), meta.product));
  // A rerun reuses the release and all successful uploads. Never change or recreate tags.
  let existing;
  try { existing = JSON.parse(gh(['release', 'view', meta.tag, '--json', 'id,isDraft,isPrerelease'])); }
  catch (error) {
    // Do not treat an authentication or network error as "not found".
    if (!String(error.stderr).includes('release not found')) throw error;
  }
  if (!existing) gh(['release', 'create', meta.tag, '--verify-tag', '--latest=false', '--title', `${meta.product} ${meta.version}`, '--notes-file', body, ...(prerelease ? ['--prerelease'] : [])]);
  else if (existing.isDraft || existing.isPrerelease !== prerelease) throw new Error('Existing release has unexpected draft/prerelease status');
  // gh release view id is a GraphQL ID; tauri-action expects the numeric REST ID.
  const release = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/releases/tags/${meta.tag}`], { encoding: 'utf8' }));
  if (!Number.isSafeInteger(release.id)) throw new Error('Missing numeric release ID');
  output.release_id = release.id;
}
for (const [key, value] of Object.entries(output)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
console.log(`Validated ${meta.tag}${dry ? ' (build only; no release)' : ''}`);
