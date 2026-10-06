import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseTag, platformComplete } from './core.mjs';
import { github } from './github.mjs';

// Runs immediately before each build, including GitHub's "rerun failed jobs".
// A published updater signature must always match the exact versioned binary.
const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.RELEASE_TAG;
const { version } = parseTag(tag);
const platform = process.env.RELEASE_PLATFORM;
if (!['darwin-aarch64', 'windows-x86_64'].includes(platform)) throw new Error('Unknown release platform');
const release = github(repository).api(`releases/tags/${tag}`);
let complete = false;
if (release.assets.some(asset => asset.name === 'latest.json')) {
  const dir = mkdtempSync(join(tmpdir(), 'agentz-platform-'));
  try {
    execFileSync('gh', ['release', 'download', tag, '--repo', repository, '--pattern', 'latest.json', '--dir', dir], { stdio: 'inherit' });
    const manifest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
    complete = platformComplete(manifest, release.assets, platform, { version, tag, repository });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
appendFileSync(process.env.GITHUB_OUTPUT, `complete=${complete}\n`);
console.log(`${platform}: ${complete ? 'already complete; preserving signed assets' : 'build required'}`);
