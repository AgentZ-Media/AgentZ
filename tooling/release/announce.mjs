import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTag, parseVersion, validateAppId } from './core.mjs';

// Tells the account backend (apps/site/convex/releases.ts) that a release or
// nightly is online, so signed-in apps check for it right away. Runs after the
// updater manifest was published. Never fails the workflow: the apps' own
// hourly check finds the update anyway.

export const DEFAULT_URL = 'https://proficient-cuttlefish-204.eu-west-1.convex.site/releases/announce';
const NIGHTLY = /-nightly\.\d+$/;

/** What to announce for this run, or null with the reason to skip. */
export function announcement(env) {
  const channel = env.CHANNEL;
  if (channel !== 'stable' && channel !== 'nightly') throw new Error(`CHANNEL must be stable or nightly: ${channel}`);
  const { app, version } = channel === 'stable'
    ? parseTag(env.RELEASE_TAG ?? '')
    : { app: validateAppId(env.APP ?? ''), version: env.VERSION ?? '' };
  const { pre } = parseVersion(version);
  // Pre-releases (rc) never move the stable pointer, so apps would find nothing.
  if (channel === 'stable' && pre.length > 0) return { skip: `${app} ${version} is a pre-release` };
  if (channel === 'nightly' && !NIGHTLY.test(version)) throw new Error(`Not a nightly version: ${version}`);
  return { app, channel, version };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function announce({ url, token, body, fetchImpl = fetch, attempts = 3, delayMs = 5000, timeoutMs = 15_000 }) {
  let last = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        // Covers reading the body too: a slow server never holds up the release.
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (response.ok) return { ok: true, text };
      last = `HTTP ${response.status} ${text}`;
      // A rejected token or request does not improve by retrying.
      if (response.status >= 400 && response.status < 500) break;
    } catch (error) {
      last = String(error?.message ?? error);
    }
    if (attempt < attempts) await wait(delayMs * attempt);
  }
  return { ok: false, text: last };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const warn = (message) => console.log(`::warning::${message}`);
  try {
    const plan = announcement(process.env);
    if (plan.skip) {
      console.log(`Not announced: ${plan.skip}.`);
    } else if (!process.env.RELEASE_ANNOUNCE_TOKEN) {
      warn('RELEASE_ANNOUNCE_TOKEN is not set; apps find the update with their hourly check.');
    } else {
      const result = await announce({
        url: process.env.RELEASE_ANNOUNCE_URL || DEFAULT_URL,
        token: process.env.RELEASE_ANNOUNCE_TOKEN,
        body: { app: plan.app, channel: plan.channel, version: plan.version },
      });
      if (result.ok) console.log(`Announced ${plan.app} ${plan.channel} ${plan.version}: ${result.text}`);
      else warn(`Announcing ${plan.app} ${plan.version} failed (${result.text}); apps find it with their hourly check.`);
    }
  } catch (error) {
    warn(`Release announcement skipped: ${error?.message ?? error}`);
  }
}
