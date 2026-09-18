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
