import test from 'node:test';
import assert from 'node:assert/strict';
import { github, publicRequest, releaseByTag, unlessNotFound } from './github.mjs';

const repository = 'AgentZ-Media/AgentZ';
function fakeExec(stdout) {
  const calls = [];
  const exec = (command, args, options) => { calls.push({ command, args, options }); return stdout; };
  return { calls, exec };
}
function ghError(stderr) {
  return Object.assign(new Error('Command failed'), { stderr });
}

test('gh appends the repository and trims stdout', () => {
  const { calls, exec } = fakeExec('  done\n');
  assert.equal(github(repository, exec).gh(['release', 'view', 'scriptz-latest']), 'done');
  assert.deepEqual(calls, [{ command: 'gh', args: ['release', 'view', 'scriptz-latest', '--repo', repository], options: { encoding: 'utf8' } }]);
});

test('api calls the repository REST path and parses JSON, null for an empty body', () => {
  const json = fakeExec('{"id":7}\n');
  assert.deepEqual(github(repository, json.exec).api('releases/tags/scriptz-latest'), { id: 7 });
  assert.deepEqual(json.calls[0].args, ['api', '-X', 'GET', `repos/${repository}/releases/tags/scriptz-latest`]);
  const empty = fakeExec('\n');
  assert.equal(github(repository, empty.exec).api('releases/assets/1', 'DELETE'), null);
  assert.deepEqual(empty.calls[0].args, ['api', '-X', 'DELETE', `repos/${repository}/releases/assets/1`]);
});

test('only the not-found marker means "no release"; other failures propagate', () => {
  assert.equal(unlessNotFound(() => { throw ghError('gh: Not Found (HTTP 404)'); }), null);
  assert.equal(unlessNotFound(() => { throw ghError('release not found'); }, 'release not found'), null);
  assert.deepEqual(unlessNotFound(() => ({ id: 1 })), { id: 1 });
  for (const error of [ghError('HTTP 401: Bad credentials'), ghError('release not found'), new SyntaxError('Unexpected end of JSON input')]) {
    assert.throws(() => unlessNotFound(() => { throw error; }), error);
  }
});

test('releaseByTag looks up the tag and maps 404 to null', () => {
  const seen = [];
  assert.deepEqual(releaseByTag(path => { seen.push(path); return { tag_name: 'scriptz-nightly' }; }, 'scriptz-nightly'), { tag_name: 'scriptz-nightly' });
  assert.deepEqual(seen, ['releases/tags/scriptz-nightly']);
  assert.equal(releaseByTag(() => { throw ghError('HTTP 404'); }, 'scriptz-nightly'), null);
  assert.throws(() => releaseByTag(() => { throw ghError('HTTP 500'); }, 'scriptz-nightly'), /Command failed/);
});

test('publicRequest retries until the asset is public and fails after six attempts', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const statuses = [404, 404, 200];
  const methods = [];
  globalThis.fetch = async (url, { method }) => { methods.push(method); return { ok: statuses[0] === 200, status: statuses.shift() }; };
  assert.equal((await publicRequest('https://example.test/a', { retryDelay: 0 })).status, 200);
  assert.deepEqual(methods, ['HEAD', 'HEAD', 'HEAD']);

  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return { ok: false, status: 403 }; };
  await assert.rejects(publicRequest('https://example.test/b', { retryDelay: 0 }), { message: 'Public asset unavailable (403): https://example.test/b' });
  assert.equal(attempts, 6);
});
