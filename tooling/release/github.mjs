import { execFileSync } from 'node:child_process';

/**
 * GitHub CLI helpers bound to one repository. `gh` runs a CLI command and
 * returns trimmed stdout; `api` calls the REST API below `repos/<repository>/`
 * and returns the parsed JSON body (`null` for an empty body).
 */
export function github(repository, exec = execFileSync) {
  const gh = args => exec('gh', [...args, '--repo', repository], { encoding: 'utf8' }).trim();
  const api = (path, method = 'GET') => {
    const text = exec('gh', ['api', '-X', method, `repos/${repository}/${path}`], { encoding: 'utf8' });
    return text.trim() ? JSON.parse(text) : null;
  };
  return { gh, api };
}

/**
 * Runs a `gh` call and returns `null` when it fails with the given "not found"
 * marker. Authentication, network and all other failures are rethrown, so
 * they are never mistaken for a missing release.
 */
export function unlessNotFound(call, marker = 'HTTP 404') {
  try { return call(); }
  catch (error) {
    if (String(error.stderr).includes(marker)) return null;
    throw error;
  }
}

/** The release with the given tag via the REST API, or `null` if none exists. */
export const releaseByTag = (api, tag) => unlessNotFound(() => api(`releases/tags/${tag}`));

/**
 * Waits until a public download URL answers without authentication: up to six
 * attempts, `retryDelay` milliseconds apart, 30 seconds each.
 */
export async function publicRequest(url, { method = 'HEAD', retryDelay = 5000 } = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, { method, signal: AbortSignal.timeout(30000) });
    if (response.ok) return response;
    if (attempt === 5) throw new Error(`Public asset unavailable (${response.status}): ${url}`);
    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }
}
