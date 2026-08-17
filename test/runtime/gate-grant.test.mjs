// Runtime regression tests for the admin gate-bypass grant path on
// `createGateRoute`'s GET handler.
//
// Clicking a site's URL in demo-tracker admin sends the browser to
// `/api/gate?t=<grant>`; this route trades that grant for a real tracker session
// and opens the storefront. Four properties are load-bearing and none of them
// type-check:
//
//   1. **A grant for a DIFFERENT demo must be rejected.** The tracker's
//      /auth/grant validates a grant against its OWN claims, not against the demo
//      presenting it, so it will happily hand back a valid session for site A to
//      site B. Only the follow-up /session check against our own slug catches it.
//      Without it, one grant would open every app-gated demo.
//   2. **The redirect must not carry the grant.** Netlify's Next runtime resolves
//      a relative Location against the request URL and keeps its query string, so
//      returning `/en-us` from `?t=<grant>` leaked the grant into the address bar,
//      browser history, the Referer sent to third-party scripts, and the tracker's
//      own events.path column (observed on logitech.ct-builders.ai 2026-08-17).
//   3. **Only a JWT-shaped session is stored.** The proxy forwards the demo_gate
//      value as a dt_session cookie only when it looks like a JWT, so storing
//      anything else opens the gate but leaves t.js unauthenticated.
//   4. **The capability flag must stay on the no-token response.** The tracker
//      probes for `grant: true` before it redirects an admin here; drop it and the
//      bypass silently reverts to a plain link.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGateRoute } from '../../dist/tracker/server/routes.js';

const HOME = '/en-us';
const ORIGIN = 'https://tracker.example.test';
const SESSION_JWT = 'aaa.bbb.ccc';

/**
 * Stub the tracker. `grantSession` is what /auth/grant hands back in Set-Cookie;
 * `sessionOk` is how /session answers the follow-up slug check.
 */
function stubTracker({ grantSession = SESSION_JWT, sessionOk = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/auth/grant')) {
      const headers = new Headers();
      if (grantSession) headers.append('set-cookie', `dt_session=${grantSession}; Path=/; HttpOnly`);
      return new Response(null, { status: 302, headers });
    }
    if (String(url).includes('/session')) {
      return new Response(null, { status: sessionOk ? 200 : 401 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { calls, fetchImpl };
}

function route(opts = {}) {
  return createGateRoute({
    homePath: HOME,
    origin: () => ORIGIN,
    slug: () => 'mydemo',
    ...opts,
  });
}

/** A request as Netlify presents it: internal URL plus forwarded headers. */
function grantRequest(token, { forwarded = true } = {}) {
  const headers = new Headers();
  if (forwarded) {
    headers.set('x-forwarded-host', 'mydemo.ct-builders.ai');
    headers.set('x-forwarded-proto', 'https');
  }
  return new Request(`https://internal.invalid/api/gate?t=${encodeURIComponent(token)}`, { headers });
}

function withFetch(fetchImpl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = original;
  });
}

test('no token: reports the grant capability the tracker probes for', async () => {
  const { GET } = route();
  const res = await GET(new Request('https://mydemo.ct-builders.ai/api/gate'));
  const body = await res.json();
  assert.equal(body.grant, true, 'tracker probes for grant:true to enable the bypass');
  assert.equal(body.authed, false);
});

test('no token: still reports authed from the gate cookie', async () => {
  const { GET } = route();
  const headers = new Headers({ cookie: `demo_gate=${SESSION_JWT}` });
  const res = await GET(new Request('https://mydemo.ct-builders.ai/api/gate', { headers }));
  assert.deepEqual(await res.json(), { authed: true, grant: true });
});

test('valid grant: sets the gate cookie to the tracker session', async () => {
  const { calls, fetchImpl } = stubTracker();
  const { GET } = route();
  const res = await withFetch(fetchImpl, () => GET(grantRequest('g-token')));

  assert.equal(res.status, 303);
  const cookie = res.headers.get('set-cookie') ?? '';
  assert.match(cookie, new RegExp(`demo_gate=${SESSION_JWT}`));
  assert.match(cookie, /SameSite=Lax/i, 'Lax survives a top-level cross-app navigation');

  // The grant is redeemed, then the resulting session is re-checked against OUR slug.
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/auth\/grant\?t=g-token/);
  assert.match(calls[1].url, /\/session\?site=mydemo/);
  assert.equal(calls[1].init.headers.cookie, `dt_session=${SESSION_JWT}`);
});

test('valid grant: redirect drops the query so the grant never lands in the URL', async () => {
  const { fetchImpl } = stubTracker();
  const { GET } = route();
  const res = await withFetch(fetchImpl, () => GET(grantRequest('g-token')));

  const location = res.headers.get('location');
  assert.equal(location, `https://mydemo.ct-builders.ai${HOME}`);
  assert.ok(!location.includes('g-token'), 'grant must not reach browser history or events.path');
  assert.ok(!location.includes('?'), 'absolute + query-free leaves Netlify nothing to inherit');
});

test('grant for a DIFFERENT site is rejected by the slug re-check', async () => {
  // /auth/grant succeeds — it validated the grant against its own claims — but
  // the session it returns belongs to another demo, so /session says 401.
  const { fetchImpl } = stubTracker({ sessionOk: false });
  const { GET } = route();
  const res = await withFetch(fetchImpl, () => GET(grantRequest('foreign-grant')));

  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /\/gate\?gate_error=1$/);
  assert.equal(res.headers.get('set-cookie'), null, 'no cookie for a foreign grant');
});

test('invalid grant (tracker sets no session) redirects to the gate', async () => {
  const { fetchImpl } = stubTracker({ grantSession: null });
  const { GET } = route();
  const res = await withFetch(fetchImpl, () => GET(grantRequest('expired')));

  assert.match(res.headers.get('location'), /\/gate\?gate_error=1$/);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('non-JWT session value is refused rather than stored', async () => {
  // '1' is the POST path's presence-marker fallback. Storing it would open the
  // gate but leave the proxy with nothing forwardable, so t.js stays unauthed.
  const { fetchImpl } = stubTracker({ grantSession: '1' });
  const { GET } = route();
  const res = await withFetch(fetchImpl, () => GET(grantRequest('g-token')));

  assert.match(res.headers.get('location'), /\/gate\?gate_error=1$/);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('unreachable tracker degrades to the gate instead of throwing', async () => {
  const fetchImpl = async () => {
    throw new Error('network down');
  };
  const { GET } = route();
  const res = await withFetch(fetchImpl, () => GET(grantRequest('g-token')));

  assert.match(res.headers.get('location'), /\/gate\?gate_error=1$/);
});

test('no slug configured: nothing is gated, so go straight home', async () => {
  const { calls, fetchImpl } = stubTracker();
  const { GET } = route({ slug: () => undefined });
  const res = await withFetch(fetchImpl, () => GET(grantRequest('g-token')));

  assert.equal(res.headers.get('location'), `https://mydemo.ct-builders.ai${HOME}`);
  assert.equal(calls.length, 0, 'no tracker call when there is no gate to satisfy');
});

test('falls back to the request URL when no forwarded headers are present', async () => {
  const { fetchImpl } = stubTracker();
  const { GET } = route();
  const req = new Request(`https://mydemo.ct-builders.ai/api/gate?t=g-token`);
  const res = await withFetch(fetchImpl, () => GET(req));

  assert.equal(res.headers.get('location'), `https://mydemo.ct-builders.ai${HOME}`);
});

// --- POST hand-off (the shape the tracker actually uses) ---------------------
//
// The grant rides in a form field precisely so it never appears in a URL. On
// Netlify that is not cosmetic: its Next runtime copies the request's search
// params onto the Location it emits, so `?t=<grant>` survived the redirect and
// reached the address bar, browser history, the Referer sent to third-party
// scripts, and the tracker's events.path column. A POST has no query to copy.

/** A form POST as the tracker's self-submitting page sends it. */
function grantPost(token, fields = {}) {
  const body = new FormData();
  if (token !== null) body.set('grant', token);
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const headers = new Headers({
    'x-forwarded-host': 'mydemo.ct-builders.ai',
    'x-forwarded-proto': 'https',
  });
  return new Request('https://internal.invalid/api/gate', { method: 'POST', body, headers });
}

test('POST grant: redeems and sets the gate cookie', async () => {
  const { calls, fetchImpl } = stubTracker();
  const { POST } = route();
  const res = await withFetch(fetchImpl, () => POST(grantPost('g-token')));

  assert.equal(res.status, 303);
  assert.match(res.headers.get('set-cookie') ?? '', new RegExp(`demo_gate=${SESSION_JWT}`));
  assert.equal(res.headers.get('location'), `https://mydemo.ct-builders.ai${HOME}`);
  // Redeemed, then re-checked against our own slug — same as the GET path.
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/session\?site=mydemo/);
});

test('POST grant takes precedence over any password in the same form', async () => {
  // A grant is a stronger credential than the shared password and must not be
  // downgraded into the /auth password flow if both fields somehow arrive.
  const { calls, fetchImpl } = stubTracker();
  const { POST } = route();
  const res = await withFetch(fetchImpl, () =>
    POST(grantPost('g-token', { email: 'someone@example.com', password: 'hunter2' })),
  );

  assert.match(res.headers.get('set-cookie') ?? '', new RegExp(`demo_gate=${SESSION_JWT}`));
  assert.match(calls[0].url, /\/auth\/grant/);
  assert.ok(!calls.some((c) => /\/auth$/.test(new URL(c.url).pathname)), 'must not hit /auth');
});

test('POST grant for a DIFFERENT site is rejected', async () => {
  const { fetchImpl } = stubTracker({ sessionOk: false });
  const { POST } = route();
  const res = await withFetch(fetchImpl, () => POST(grantPost('foreign-grant')));

  assert.match(res.headers.get('location'), /\/gate\?gate_error=1$/);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('POST without a grant still runs the ordinary password flow', async () => {
  // Regression guard: the gate's own form must be unaffected by the grant branch.
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const headers = new Headers();
    headers.append('set-cookie', `dt_session=${SESSION_JWT}; Path=/`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  };
  const { POST } = route();
  const res = await withFetch(fetchImpl, () =>
    POST(grantPost(null, { email: 'someone@example.com', password: 'hunter2' })),
  );

  assert.equal(res.status, 303);
  assert.match(calls[0].url, /\/auth$/, 'password flow goes to /auth, not /auth/grant');
  assert.match(res.headers.get('set-cookie') ?? '', new RegExp(`demo_gate=${SESSION_JWT}`));
});
