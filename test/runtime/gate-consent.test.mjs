// Runtime tests for the gate's consent rule.
//
// A visit is recorded only when the visitor ticks the gate's consent box, and a
// visitor who leaves it unticked still gets in. Three places carry that, and
// none of it type-checks:
//
//   1. `createGateRoute` sends the email to the tracker only with the tick, and
//      sends the tick itself as `consent: true`. Without it the tracker gets the
//      password alone — on an open site, nothing but the slug.
//   2. The gated tracker proxy forwards only a consenting visitor. Everyone else
//      is answered locally: a silent stand-in for `t.js`, and `/session` and
//      `/event` answered as the tracker would, so nothing reaches the tracker.
//   3. `gateConsent()` is true only when the tracker says so. A tracker answer
//      without the flag reads as no consent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const ORIGIN = 'https://tracker.example.test';
const DECLINED = 'aaa.declined.ccc';
const CONSENTED = 'aaa.consented.ccc';

process.env.NODE_ENV = 'production';
process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE = 'mydemo';
process.env.NEXT_PUBLIC_DEMO_TRACKER_URL = ORIGIN;

const { createGateRoute, createTrackerProxyRoute } = await import('../../dist/tracker/server/routes.js');
const { gateConsent, resetGateVerifyCache } = await import('../../dist/tracker/server/gate.js');

const realFetch = globalThis.fetch;

/** Stand in for the tracker. `/auth` answers with `authToken`; `/session` knows two tokens. */
function stubTracker({ authToken = DECLINED, sessionBody = (c) => ({ ok: true, consent: c === CONSENTED }) } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const cookie = (init.headers instanceof Headers ? init.headers.get('cookie') : init.headers?.cookie) ?? '';
    calls.push({ url: u, method: init.method ?? 'GET', cookie, body: init.body });
    if (u.endsWith('/auth')) {
      const headers = new Headers({ 'content-type': 'application/json' });
      headers.append('set-cookie', `dt_session=${authToken}; Path=/; HttpOnly`);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }
    if (u.includes('/session')) {
      const token = cookie.replace(/^dt_session=/, '');
      if (token !== DECLINED && token !== CONSENTED) return new Response(null, { status: 401 });
      const body = sessionBody(token);
      return body === null
        ? new Response(null, { status: 200 })
        : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('upstream:' + new URL(u).pathname, { status: 200 });
  };
  return calls;
}

test.beforeEach(() => resetGateVerifyCache());
test.afterEach(() => {
  globalThis.fetch = realFetch;
  resetGateVerifyCache();
});

const gatePost = (fields) =>
  new Request('https://demo.example.test/api/gate', {
    method: 'POST',
    body: new URLSearchParams(fields),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

const authBody = (calls) => JSON.parse(calls.find((c) => c.url.endsWith('/auth')).body);

test('1a. no tick: the tracker gets the password alone, never the email', async () => {
  const calls = stubTracker();
  const { POST } = createGateRoute({ homePath: '/en-us' });
  // A browser that kept an email in the field from an earlier tick still sends
  // nothing but the password.
  const res = await POST(gatePost({ password: 'hunter2', email: 'jen@example.com' }));
  assert.equal(res.status, 303);
  assert.deepEqual(authBody(calls), { site: 'mydemo', password: 'hunter2' });
  assert.match(res.headers.get('set-cookie'), new RegExp(`^demo_gate=${DECLINED};`));
});

test('1b. no tick on an open site: in on the consent choice alone', async () => {
  const calls = stubTracker();
  const { POST } = createGateRoute({ homePath: '/en-us' });
  const res = await POST(gatePost({}));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/en-us');
  assert.deepEqual(authBody(calls), { site: 'mydemo', password: '' });
});

test('1c. a tick sends the email and the consent', async () => {
  const calls = stubTracker({ authToken: CONSENTED });
  const { POST } = createGateRoute({ homePath: '/en-us' });
  const res = await POST(gatePost({ password: 'hunter2', consent: 'on', email: ' jen@example.com ' }));
  assert.equal(res.status, 303);
  assert.deepEqual(authBody(calls), {
    site: 'mydemo',
    email: 'jen@example.com',
    password: 'hunter2',
    consent: true,
  });
  assert.match(res.headers.get('set-cookie'), new RegExp(`^demo_gate=${CONSENTED};`));
});

const proxy = createTrackerProxyRoute({ mode: 'gated' });
const proxied = (path, gate, init = {}) =>
  proxy(
    new Request(`https://demo.example.test/api/tracker${path}`, {
      ...init,
      headers: { ...(gate ? { cookie: `demo_gate=${gate}; other=1` } : {}), ...(init.headers ?? {}) },
    }),
  );
const upstreamCalls = (calls) => calls.filter((c) => !c.url.includes('/session'));

test('2a. through the gate without consent: nothing reaches the tracker', async () => {
  const calls = stubTracker();
  const js = await proxied('/t.js?site=mydemo', DECLINED);
  assert.equal(js.status, 200);
  assert.equal(js.headers.get('cache-control'), 'no-store');
  const body = await js.text();
  assert.match(body, /consent:false/);
  assert.doesNotMatch(body, /fetch|sendBeacon/, 'the stand-in sends nothing');

  const ev = await proxied('/event', DECLINED, {
    method: 'POST',
    body: JSON.stringify({ site: 'mydemo', type: 'pageview', path: '/en-us', customer_email: 'a@b.example' }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(ev.status, 200);
  assert.deepEqual(await ev.json(), { ok: true, consent: false });

  const se = await proxied('/session?site=mydemo', DECLINED);
  assert.deepEqual(await se.json(), { ok: true, consent: false });

  assert.deepEqual(upstreamCalls(calls), [], 'only the server-side /session verdict may reach the tracker');
});

test('2b. no gate cookie: nothing reaches the tracker at all', async () => {
  const calls = stubTracker();
  assert.equal((await proxied('/t.js?site=mydemo')).status, 200);
  assert.equal((await proxied('/event', undefined, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await proxied('/session?site=mydemo')).status, 401);
  assert.deepEqual(calls, []);
});

test('2c. a consenting visitor is forwarded with the tracker cookie, and only that', async () => {
  const calls = stubTracker();
  const js = await proxied('/t.js?site=mydemo', CONSENTED);
  assert.equal(await js.text(), 'upstream:/t.js');
  const ev = await proxied('/event', CONSENTED, { method: 'POST', body: '{}' });
  assert.equal(await ev.text(), 'upstream:/event');
  const forwarded = upstreamCalls(calls);
  assert.equal(forwarded.length, 2);
  for (const c of forwarded) assert.equal(c.cookie, `dt_session=${CONSENTED}`);
});

test('3. gateConsent is true only on the tracker saying so', async () => {
  stubTracker();
  assert.equal(await gateConsent(CONSENTED), true);
  assert.equal(await gateConsent(DECLINED), false);
  assert.equal(await gateConsent(undefined), false);
  assert.equal(await gateConsent('not-a-jwt'), false);
  assert.equal(await gateConsent('aaa.unknown.ccc'), false);
});

test('3b. a tracker answer without the consent flag reads as no consent', async () => {
  stubTracker({ sessionBody: () => null });
  assert.equal(await gateConsent(CONSENTED), false);
  stubTracker({ sessionBody: () => ({ ok: true }) });
  resetGateVerifyCache();
  assert.equal(await gateConsent(CONSENTED), false);
});
