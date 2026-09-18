// Runtime regression tests for what the app gate accepts as proof.
//
// The bug this exists to prevent: the gate is satisfied by the PRESENCE of a
// `demo_gate` cookie, so `curl -H 'Cookie: demo_gate=anything'` renders the
// whole storefront and the site password stops meaning anything. The cookie's
// value is the tracker's own `dt_session` JWT, so it can be checked — and a
// forged one also defeats the tracker proxy, which means the bypasser leaves no
// session and no events behind.
//
//   1. A value that is not JWT-shaped is refused, and costs no round trip.
//   2. A JWT-shaped value the tracker does not recognise is refused.
//   3. A token the tracker confirms for THIS slug is accepted.
//   4. A token minted for a DIFFERENT slug is refused — /session answers 401 on
//      a claims/slug mismatch, and that is what keeps one password from opening
//      every demo.
//   5. Verdicts are cached, so reading a demo is not one tracker call per render.
//   6. An unreachable tracker is not a verdict: a visitor already verified on
//      this lambda stays in, a stranger does not get in.
//   7. The gate is inert with no slug configured or outside production.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'production';
process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE = 'mydemo';

const { isGateOpen, resetGateVerifyCache } = await import('../../dist/tracker/server/gate.js');

const GOOD = 'eyJhbGciOiJIUzI1NiJ9.eyJ2IjoxLCJzaWQiOjd9.c2lnbmF0dXJl';
const realFetch = globalThis.fetch;

/** Stand in for the tracker. Records every call so "no round trip" is testable. */
function stubTracker(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), cookie: init?.headers?.cookie ?? '' });
    return handler({ url: String(url), cookie: init?.headers?.cookie ?? '' });
  };
  return calls;
}

function ok200({ url, cookie }) {
  const site = new URL(url).searchParams.get('site');
  const valid = cookie === `dt_session=${GOOD}` && site === 'mydemo';
  return new Response(null, { status: valid ? 200 : 401 });
}

test.beforeEach(() => resetGateVerifyCache());
test.afterEach(() => {
  globalThis.fetch = realFetch;
  resetGateVerifyCache();
});

test('1. a non-JWT cookie value is refused without calling the tracker', async () => {
  const calls = stubTracker(ok200);
  for (const forged of ['anything', '1', 'true', '', 'a.b', 'a.b.c.d', 'not a jwt']) {
    assert.equal(await isGateOpen(forged), false, `accepted ${JSON.stringify(forged)}`);
  }
  assert.equal(await isGateOpen(undefined), false);
  assert.equal(calls.length, 0, 'a forged shape must not cost a tracker round trip');
});

test('2. a JWT-shaped value the tracker rejects is refused', async () => {
  const calls = stubTracker(ok200);
  assert.equal(await isGateOpen('a.b.c'), false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/session\?site=mydemo$/);
  assert.equal(calls[0].cookie, 'dt_session=a.b.c');
});

test('3. a token the tracker confirms is accepted', async () => {
  stubTracker(ok200);
  assert.equal(await isGateOpen(GOOD), true);
});

test('4. a token minted for another site is refused', async () => {
  // /session compares the session's claims against the slug in the query, so a
  // real token from another demo comes back 401 here.
  stubTracker(({ url }) =>
    new Response(null, { status: new URL(url).searchParams.get('site') === 'otherdemo' ? 200 : 401 }),
  );
  assert.equal(await isGateOpen(GOOD), false);
});

test('5. a verdict is cached, so rendering a page is not a tracker call per render', async () => {
  const calls = stubTracker(ok200);
  for (let i = 0; i < 25; i++) assert.equal(await isGateOpen(GOOD), true);
  assert.equal(calls.length, 1);

  // A refusal is cached too, so a loop of forged tokens can't hammer the tracker.
  for (let i = 0; i < 25; i++) assert.equal(await isGateOpen('a.b.c'), false);
  assert.equal(calls.length, 2);
});

test('6. an unreachable tracker holds the line without locking out a live visitor', async () => {
  stubTracker(ok200);
  assert.equal(await isGateOpen(GOOD), true); // verified while the tracker was up

  for (const outage of [
    () => { throw new Error('ECONNREFUSED'); },
    () => new Response(null, { status: 503 }),
  ]) {
    stubTracker(outage);
    // Known-good visitor rides out the outage on the cached verdict...
    assert.equal(await isGateOpen(GOOD), true);
    // ...and a stranger still does not get in. They could not have
    // authenticated anyway: /auth is on the same unreachable tracker.
    assert.equal(await isGateOpen('z.z.z'), false);
  }
});

test('7. the gate is inert with no slug, or outside production', async () => {
  const calls = stubTracker(ok200);
  process.env.NODE_ENV = 'development';
  try {
    assert.equal(await isGateOpen(undefined), true);
  } finally {
    process.env.NODE_ENV = 'production';
  }

  delete process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE;
  try {
    assert.equal(await isGateOpen(undefined), true);
  } finally {
    process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE = 'mydemo';
  }
  assert.equal(calls.length, 0);
});
