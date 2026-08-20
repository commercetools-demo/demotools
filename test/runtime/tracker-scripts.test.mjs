// Runtime tests for TrackerScripts' render gate.
//
// The bug these pin: it required NEXT_PUBLIC_DEMO_TRACKER_URL as well as the
// slug. That variable is documented as optional (trackerOrigin() defaults it)
// and is never used client-side — the script loads from the first-party proxy
// path. But the GATE keys off the slug alone, so a demo configured exactly as
// documented gated correctly and recorded zero analytics, which reads as an
// unused demo rather than a broken one.
//
// Env has to be set before the module is imported: config.ts reads
// process.env at call time, but the values are what the test controls here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import TrackerScripts from '../../dist/tracker/TrackerScripts.js';

const render = (props) => renderToStaticMarkup(React.createElement(TrackerScripts, props));

test('a slug alone is enough — no NEXT_PUBLIC_DEMO_TRACKER_URL required', () => {
  delete process.env.NEXT_PUBLIC_DEMO_TRACKER_URL;
  const html = render({ site: 'acme-demo' });
  assert.match(html, /src="\/api\/tracker\/t\.js\?site=acme-demo"/);
  // The tracker origin must not appear client-side at all: t.js derives its API
  // base from document.currentScript, which is what keeps requests first-party
  // (the iOS Safari ITP fix).
  assert.doesNotMatch(html, /tracker\.ctdemo\.net/);
});

test('no slug means no scripts (an unconfigured fork stays clean)', () => {
  delete process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE;
  assert.equal(render({}), '');
});

test('window.dt is seeded before t.js loads, with the gate off by default', () => {
  const html = render({ site: 'acme-demo' });
  const dtAt = html.indexOf('window.dt=');
  const jsAt = html.indexOf('t.js?site=');
  assert.ok(dtAt >= 0 && jsAt > dtAt, 'window.dt must be written before t.js');
  assert.match(html, /gate:false/);
  // …and it carries the context, which t.js reads synchronously.
  const withCtx = render({ site: 'a', context: { store: 'us-store' } });
  assert.match(withCtx, /"store":"us-store"/);
});

test('a custom basePath is honoured (proxy mounted elsewhere)', () => {
  assert.match(render({ site: 'a', basePath: '/x/tracker' }), /src="\/x\/tracker\/t\.js\?site=a"/);
});
