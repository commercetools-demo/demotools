// Runtime tests for the track() shim.
//
// The bug these pin: `window.dt` has two stages — <TrackerScripts> writes an
// inline `{ context, gate }` during parse, and the deferred `t.js` later adds
// `track`. React can run effects before a deferred script executes, so a
// <TrackEvent> on a heavy streamed page fired against a stage-1 `window.dt`.
// The old shim did `dt?.track(event, props)`: the optional chain guards `dt`
// being absent, not `track` being absent, so it threw a TypeError into a bare
// catch and the event vanished. Demos recorded hundreds of pageviews and a
// handful of view_category/view_product rows, which reads as an unused demo
// rather than a broken one.
//
// track() must now record the event either way — via t.js when it is there, and
// by posting the same payload to the same first-party proxy when it is not.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE = 'acme-demo';

const { track } = await import('../../dist/tracker/track.js');

let posts;

beforeEach(() => {
  posts = [];
  globalThis.window = globalThis;
  globalThis.location = { pathname: '/en-us/category/rugs', search: '' };
  globalThis.fetch = (url, init) => {
    posts.push({ url, body: JSON.parse(init.body), keepalive: init.keepalive });
    return Promise.resolve({ ok: true, status: 200 });
  };
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.location;
  delete globalThis.fetch;
  delete globalThis.dt;
});

test('stage 1: window.dt exists but has no track — the event is still recorded', () => {
  // Exactly what <TrackerScripts> writes inline, before t.js executes.
  globalThis.dt = { context: { store: 'US' }, gate: false };

  track('view_category', { slug: 'rugs' });

  assert.equal(posts.length, 1, 'the event must not be dropped');
  assert.equal(posts[0].url, '/api/tracker/event', 'posts first-party, not cross-origin');
  assert.equal(posts[0].keepalive, true, 'survives a navigation started right after');
  assert.deepEqual(posts[0].body, {
    site: 'acme-demo',
    store: 'US',
    type: 'view_category',
    path: '/en-us/category/rugs',
    props: { slug: 'rugs' },
  });
});

test('stage 1 carries the customer context t.js would have attached', () => {
  globalThis.dt = {
    context: { store: 'US', channel: 'web', customer: { id: 'c-1', email: 'a@b.com' } },
    gate: false,
  };

  track('place_order', { orderNumber: 'GS-1', totalCents: 1234 });

  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.customer_id, 'c-1');
  assert.equal(posts[0].body.customer_email, 'a@b.com');
  assert.equal(posts[0].body.channel, 'web');
  // Revenue reporting depends on this surviving the stage-1 window.
  assert.equal(posts[0].body.props.totalCents, 1234);
});

test('stage 2: once t.js installs track, that path is used and nothing is double-sent', () => {
  const seen = [];
  globalThis.dt = { context: { store: 'US' }, track: (t, p) => seen.push([t, p]) };

  track('add_to_cart', { sku: 'RUG-1' });

  assert.deepEqual(seen, [['add_to_cart', { sku: 'RUG-1' }]]);
  assert.equal(posts.length, 0, 'must not also post directly');
});

test('event type is lowercased on the direct path, matching t.js', () => {
  globalThis.dt = { context: {} };
  track('View_Product', { sku: 'X' });
  assert.equal(posts[0].body.type, 'view_product');
});

test('no window.dt at all (script blocked) still records', () => {
  track('search', { query: 'wool rug' });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.type, 'search');
});

test('never throws, whatever window.dt is', () => {
  for (const bad of [null, undefined, 42, 'nope', { track: 'not-a-function' }]) {
    globalThis.dt = bad;
    assert.doesNotThrow(() => track('view_product', { sku: 'A' }));
  }
});

test('a fork with no slug configured stays silent', async () => {
  delete process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE;
  try {
    globalThis.dt = { context: {} };
    track('view_product', { sku: 'A' });
    assert.equal(posts.length, 0, 'tracker off for this deploy — post nothing');
  } finally {
    process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE = 'acme-demo';
  }
});
