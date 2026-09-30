// Runtime regression tests for the API-route guard.
//
// The bug this exists to prevent: the gate is enforced in
// `app/[locale]/layout.tsx`, and `app/api/**` is not under it. A gated demo
// therefore answers its own API to anyone — `/api/product/search`,
// `/api/countries` and the cart and customer writes all returned 200 with no
// cookie on logitech.ct-builders.ai (2026-09-18), against the live
// commercetools project behind it.
//
//   1. No cookie is a 401, and the handler never runs.
//   2. A forged cookie is a 401 — the guard is the verified check, not a
//      second presence test.
//   3. A verified cookie runs the handler, with every argument intact (dynamic
//      routes take a second `ctx` param).
//   4. The guard is inert wherever the gate is: no slug, or outside production.
//      A fork with no tracker slug must not 401 its own storefront.
//
// And the second way in, for a demo whose page gate has one (5–9). A Customer
// Service agent's grant rides on the app's session, never on `demo_gate` — the
// storefront cannot mint the tracker-signed JWT the cookie check verifies. So a
// route reading only the cookie refuses every request of an assisted session,
// which is invisible in a first-party tab (a Lax `demo_gate` from an ordinary
// visit rides along) and total inside the Merchant Center's third-party frame.
// Pages keep rendering, the CSR banner keeps naming the customer, and every
// fetch underneath 401s.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'production';
process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE = 'mydemo';

const { withGate } = await import('../../dist/tracker/server/routes.js');
const { resetGateVerifyCache } = await import('../../dist/tracker/server/gate.js');

const GOOD = 'eyJhbGciOiJIUzI1NiJ9.eyJ2IjoxfQ.c2ln';
const realFetch = globalThis.fetch;

function stubTracker() {
  globalThis.fetch = async (_url, init) =>
    new Response(null, { status: init?.headers?.cookie === `dt_session=${GOOD}` ? 200 : 401 });
}

function req(cookie) {
  return new Request('https://demo.test/api/product/search?q=mouse', {
    headers: cookie ? new Headers({ cookie }) : new Headers(),
  });
}

test.beforeEach(() => {
  resetGateVerifyCache();
  stubTracker();
});
test.afterEach(() => {
  globalThis.fetch = realFetch;
  resetGateVerifyCache();
});

test('1. no cookie: 401, and the handler is never reached', async () => {
  let ran = false;
  const GET = withGate(async () => {
    ran = true;
    return Response.json({ products: ['secret'] });
  });

  const res = await GET(req(undefined));
  assert.equal(res.status, 401);
  assert.equal(ran, false, 'the handler must not run — it talks to the live CT project');
  assert.deepEqual(await res.json(), { error: 'Demo access required' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('2. a forged cookie is refused', async () => {
  const GET = withGate(async () => Response.json({ ok: true }));
  for (const forged of ['demo_gate=anything', 'demo_gate=1', 'demo_gate=a.b.c']) {
    assert.equal((await GET(req(forged))).status, 401, `accepted ${forged}`);
  }
});

test('3. a verified cookie runs the handler, arguments intact', async () => {
  const seen = [];
  const GET = withGate(async (request, ctx) => {
    seen.push([new URL(request.url).searchParams.get('q'), ctx]);
    return Response.json({ ok: true });
  });

  const ctx = { params: Promise.resolve({ orderId: 'o-1' }) };
  const res = await GET(req(`demo_gate=${GOOD}`), ctx);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 'mouse');
  assert.equal(seen[0][1], ctx, 'the dynamic-route ctx must reach the handler unchanged');
});

test('4. inert wherever the gate is inert', async () => {
  const GET = withGate(async () => Response.json({ ok: true }));

  delete process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE;
  try {
    assert.equal((await GET(req(undefined))).status, 200, 'an ungated fork must serve its own API');
  } finally {
    process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE = 'mydemo';
  }

  process.env.NODE_ENV = 'development';
  try {
    assert.equal((await GET(req(undefined))).status, 200, 'local dev must not need a cookie');
  } finally {
    process.env.NODE_ENV = 'production';
  }
});

// ---------------------------------------------------------------------------
// The app-supplied second way in.

test('5. no bypass: byte-identical to the cookie-only guard', async () => {
  // The default must not move. Every demo in the fleet is on this path.
  const plain = withGate(async () => Response.json({ ok: true }));
  const withOpts = withGate(async () => Response.json({ ok: true }), {});

  for (const GET of [plain, withOpts]) {
    const refused = await GET(req(undefined));
    assert.equal(refused.status, 401);
    assert.deepEqual(await refused.json(), { error: 'Demo access required' });
    assert.equal(refused.headers.get('content-type'), 'application/json');
    assert.equal(refused.headers.get('cache-control'), 'no-store');
    assert.equal((await GET(req(`demo_gate=${GOOD}`))).status, 200);
  }
});

test('6. a bypass lets a cookie-less request through, and gets the request', async () => {
  const seen = [];
  const GET = withGate(async () => Response.json({ ok: true }), {
    bypass: async (request) => {
      seen.push(new URL(request.url).pathname);
      return true;
    },
  });

  const res = await GET(req(undefined));
  assert.equal(res.status, 200, 'an assisted session must not be refused');
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(seen, ['/api/product/search'], 'the bypass sees the real request');
});

test('7. the bypass is asked before the cookie, and only when the gate is on', async () => {
  const order = [];
  globalThis.fetch = async () => {
    order.push('tracker');
    return new Response(null, { status: 401 });
  };
  const bypass = () => {
    order.push('bypass');
    return false;
  };

  // Gate on, bypass declines: it was consulted, and only then the cookie — the
  // session read is local, the cookie check can cost a round trip.
  const GET = withGate(async () => Response.json({ ok: true }), { bypass });
  assert.equal((await GET(req(`demo_gate=${GOOD}`))).status, 401);
  assert.deepEqual(order, ['bypass', 'tracker']);

  // Gate off: nothing is asked at all. An ungated fork must not pay for, or
  // depend on, a session lookup to serve its own API.
  order.length = 0;
  process.env.NODE_ENV = 'development';
  try {
    assert.equal((await GET(req(undefined))).status, 200);
    assert.deepEqual(order, [], 'the env check short-circuits both');
  } finally {
    process.env.NODE_ENV = 'production';
  }
});

test('8. only true grants; anything else falls through to the cookie', async () => {
  // A bypass that returns the session object rather than the flag on it is
  // truthy, and must grant nothing.
  for (const value of [false, undefined, null, 0, '', 'true', 1, { gateBypass: true }]) {
    const GET = withGate(async () => Response.json({ ok: true }), { bypass: () => value });
    assert.equal(
      (await GET(req(undefined))).status,
      401,
      `a bypass returning ${JSON.stringify(value) ?? String(value)} opened the gate`,
    );
    assert.equal(
      (await GET(req(`demo_gate=${GOOD}`))).status,
      200,
      'a declining bypass must not block a verified cookie',
    );
  }
});

test('9. a throwing bypass is not an answer', async () => {
  // A session that fails to decode must not take the API down, and must not
  // open it either — the cookie still decides.
  for (const bypass of [
    () => {
      throw new Error('session decode failed');
    },
    async () => {
      throw new Error('session decode failed');
    },
  ]) {
    const GET = withGate(async () => Response.json({ ok: true }), { bypass });
    assert.equal((await GET(req(undefined))).status, 401);
    assert.equal((await GET(req(`demo_gate=${GOOD}`))).status, 200);
  }
});
