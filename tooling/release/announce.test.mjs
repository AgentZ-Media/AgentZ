import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { announce, announcement } from './announce.mjs';

describe('announcement', () => {
  it('reads stable releases from the tag and nightlies from app and version', () => {
    assert.deepEqual(announcement({ CHANNEL: 'stable', RELEASE_TAG: 'scriptz-v0.12.0' }), { app: 'scriptz', channel: 'stable', version: '0.12.0' });
    assert.deepEqual(announcement({ CHANNEL: 'nightly', APP: 'scriptz', VERSION: '0.12.1-nightly.202610071200' }),
      { app: 'scriptz', channel: 'nightly', version: '0.12.1-nightly.202610071200' });
  });

  it('skips stable pre-releases, which never move the pointer', () => {
    assert.match(announcement({ CHANNEL: 'stable', RELEASE_TAG: 'scriptz-v1.0.0-rc.1' }).skip, /pre-release/);
  });

  it('rejects anything else', () => {
    assert.throws(() => announcement({ CHANNEL: 'beta', RELEASE_TAG: 'scriptz-v1.0.0' }));
    assert.throws(() => announcement({ CHANNEL: 'nightly', APP: 'scriptz', VERSION: '1.0.0' }));
    assert.throws(() => announcement({ CHANNEL: 'stable', RELEASE_TAG: 'nonsense' }));
  });
});

describe('announce', () => {
  const response = (status, text = '{}') => ({ ok: status < 300, status, text: async () => text });

  it('sends the bearer token and the release', async () => {
    const calls = [];
    const result = await announce({
      url: 'https://x/releases/announce', token: 't', body: { app: 'scriptz', channel: 'stable', version: '1.0.0' },
      fetchImpl: async (url, init) => { calls.push([url, init]); return response(200, '{"updated":true}'); },
    });
    assert.equal(result.ok, true);
    assert.equal(calls[0][1].headers.Authorization, 'Bearer t');
    assert.deepEqual(JSON.parse(calls[0][1].body), { app: 'scriptz', channel: 'stable', version: '1.0.0' });
  });

  it('retries server and network errors but not a rejected request', async () => {
    let n = 0;
    const flaky = await announce({ url: 'u', token: 't', body: {}, delayMs: 0, fetchImpl: async () => {
      n += 1;
      if (n === 1) throw new Error('offline');
      return n === 2 ? response(502) : response(200);
    } });
    assert.equal(flaky.ok, true);
    assert.equal(n, 3);
    let m = 0;
    const rejected = await announce({ url: 'u', token: 't', body: {}, delayMs: 0, fetchImpl: async () => { m += 1; return response(401, 'no'); } });
    assert.equal(rejected.ok, false);
    assert.equal(m, 1);
  });
});
