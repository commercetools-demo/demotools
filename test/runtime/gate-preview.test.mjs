// Runtime regression tests for the page-builder preview carve-out on the demo gate.
//
// The bug this exists to prevent: a gated demo answers `307 → /gate` for every
// preview URL the page editor loads, so the WYSIWYG canvas shows the email form
// instead of the storefront (observed on thegoodstore 2026-08-18). None of the
// properties below type-check, and none of them reproduce locally either — the
// gate is inert unless NODE_ENV === 'production', so a dev run is always open.
//
//   1. A framed request from an ALLOWLISTED origin is let through. This is the
//      whole fix; it is also the rule that has to work on the frame's own
//      document, where the token is unreachable (query string, and a layout gets
//      no searchParams).
//   2. A framed request from an origin NOT on the allowlist is blocked. The
//      allowlist is the only thing separating "the editor" from "anyone who can
//      iframe a URL", so an unbounded frame rule would drop the gate entirely.
//   3. A same-origin sub-request carrying the real token in its Referer is let
//      through as 'editor-token' — the strong rule, and the one that keeps
//      in-frame navigation (RSC payloads) from hitting the gate mid-session.
//   4. A WRONG token does not fall back into a pass. It may still match rule 1
//      on its shape, but it must never be reported as 'editor-token'.
//   5. With no PB_PREVIEW_TOKEN or an empty allowlist, nothing is let through:
//      a demo with no page builder must not acquire an iframe bypass.
//   6. The `?pb=<dest>` hint rides on the redirect for a non-document request,
//      and is absent for an ordinary visitor. From inside an iframe the Location
//      header is the only part of the 307 the parent document can see.
//   7. `gateVerdict` consults the headers only when the cookie is absent, and
//      degrades to the plain cookie check when no preview config is passed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// The gate is inert outside production, so `gateVerdict` would answer 'disabled'
// for every case below. Set both before importing anything that reads them.
process.env.NODE_ENV = 'production';
process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE = 'mydemo';

const { editorPreviewVerdict, gateRedirectPath, DEFAULT_PREVIEW_PARAM } = await import(
  '../../dist/tracker/server/preview.js'
);
const { gateVerdict } = await import('../../dist/tracker/server/gate.js');

const MC = 'https://mc.us-central1.gcp.commercetools.com';
const TOKEN = 'tok_abcdef0123456789';
const PREVIEW = { allowedOrigins: [MC], previewToken: TOKEN };

/** Headers as a browser would send them. */
const h = (o) => new Headers(Object.entries(o).filter(([, v]) => v != null));

test('1. the frame document from an allowlisted origin is let through', () => {
  // Cross-site Referer is trimmed to the framing document's origin — no token available.
  const headers = h({ 'sec-fetch-dest': 'iframe', referer: `${MC}/` });
  assert.equal(editorPreviewVerdict(headers, PREVIEW), 'editor-frame');
});

test('2. a framed request from an origin off the allowlist is blocked', () => {
  const headers = h({ 'sec-fetch-dest': 'iframe', referer: 'https://evil.example/' });
  assert.equal(editorPreviewVerdict(headers, PREVIEW), 'blocked');
});

test('3. a same-origin sub-request carrying the real token is editor-token', () => {
  // An in-frame RSC navigation: same-origin, so Referer is the FULL preview URL.
  const headers = h({
    'sec-fetch-dest': 'empty',
    referer: `https://thegoodstore.ct-builders.ai/en-us?${DEFAULT_PREVIEW_PARAM}=${TOKEN}&pb_edit=1`,
  });
  assert.equal(editorPreviewVerdict(headers, PREVIEW), 'editor-token');
});

test('4. a wrong token is never reported as editor-token', () => {
  const headers = h({
    'sec-fetch-dest': 'empty',
    referer: `https://thegoodstore.ct-builders.ai/en-us?${DEFAULT_PREVIEW_PARAM}=wrong`,
  });
  assert.equal(editorPreviewVerdict(headers, PREVIEW), 'blocked');
});

test('4b. a custom previewParam is honoured over the default', () => {
  const headers = h({ referer: `https://x.test/en-us?pb_preview_v2=${TOKEN}` });
  const opts = { ...PREVIEW, previewParam: 'pb_preview_v2' };
  assert.equal(editorPreviewVerdict(headers, opts), 'editor-token');
  // …and the default no longer matches that URL.
  assert.equal(editorPreviewVerdict(headers, PREVIEW), 'blocked');
});

test('5. no token or no allowlist means no exception at all', () => {
  const framed = h({ 'sec-fetch-dest': 'iframe', referer: `${MC}/` });
  const tokened = h({ referer: `https://x.test/?${DEFAULT_PREVIEW_PARAM}=${TOKEN}` });
  for (const opts of [
    { allowedOrigins: [MC], previewToken: undefined },
    { allowedOrigins: [], previewToken: TOKEN },
  ]) {
    assert.equal(editorPreviewVerdict(framed, opts), 'blocked');
    assert.equal(editorPreviewVerdict(tokened, opts), 'blocked');
  }
});

test('a top-level document navigation is blocked even from an allowlisted origin', () => {
  // A visitor who followed a link from the Merchant Center is still a visitor.
  const headers = h({ 'sec-fetch-dest': 'document', referer: `${MC}/` });
  assert.equal(editorPreviewVerdict(headers, PREVIEW), 'blocked');
});

test('deliberate looseness: a framed request with no Referer at all passes', () => {
  // A no-referrer policy on the framing document; documented trade-off.
  assert.equal(editorPreviewVerdict(h({ 'sec-fetch-dest': 'iframe' }), PREVIEW), 'editor-frame');
});

test('deliberate looseness: absent Sec-Fetch-* falls back to the allowlisted Referer (WebKit)', () => {
  assert.equal(editorPreviewVerdict(h({ referer: `${MC}/` }), PREVIEW), 'editor-frame');
  assert.equal(editorPreviewVerdict(h({ referer: 'https://evil.example/' }), PREVIEW), 'blocked');
  // Nothing at all is not a frame.
  assert.equal(editorPreviewVerdict(h({}), PREVIEW), 'blocked');
});

test('an unparseable Referer does not throw, and falls through to the frame rule', () => {
  const headers = h({ 'sec-fetch-dest': 'iframe', referer: 'not a url' });
  // originOf() yields null, so the "framed with no usable origin" branch allows it.
  assert.equal(editorPreviewVerdict(headers, PREVIEW), 'editor-frame');
});

test('a getter function works in place of a Headers object', () => {
  const map = { 'sec-fetch-dest': 'iframe', referer: `${MC}/` };
  assert.equal(editorPreviewVerdict((n) => map[n] ?? null, PREVIEW), 'editor-frame');
  assert.equal(editorPreviewVerdict((n) => map[n], PREVIEW), 'editor-frame'); // undefined, not null
});

test('6. the ?pb= hint rides on the redirect only for a non-document request', () => {
  assert.equal(gateRedirectPath(h({ 'sec-fetch-dest': 'iframe' })), '/gate?pb=iframe');
  assert.equal(gateRedirectPath(h({ 'sec-fetch-dest': 'empty' })), '/gate?pb=empty');
  // An ordinary visitor gets a clean /gate — no diagnostic noise in the address bar.
  assert.equal(gateRedirectPath(h({ 'sec-fetch-dest': 'document' })), '/gate');
  assert.equal(gateRedirectPath(h({})), '/gate');
  // Custom gate path, and an existing query is appended to rather than clobbered.
  assert.equal(gateRedirectPath(h({ 'sec-fetch-dest': 'iframe' }), '/enter'), '/enter?pb=iframe');
  assert.equal(gateRedirectPath(h({ 'sec-fetch-dest': 'iframe' }), '/gate?a=1'), '/gate?a=1&pb=iframe');
});

test('7. gateVerdict: cookie short-circuits, and no preview config means cookie-only', () => {
  const framed = h({ 'sec-fetch-dest': 'iframe', referer: `${MC}/` });

  assert.equal(gateVerdict({ gateCookieValue: 'x.y.z', headers: framed, preview: PREVIEW }), 'authed');
  assert.equal(gateVerdict({ gateCookieValue: undefined, headers: framed, preview: PREVIEW }), 'editor-frame');
  // A demo with no page builder: the editor exception does not exist.
  assert.equal(gateVerdict({ gateCookieValue: undefined, headers: framed }), 'blocked');
  assert.equal(gateVerdict({ gateCookieValue: undefined }), 'blocked');
  assert.equal(gateVerdict({ gateCookieValue: 'x.y.z' }), 'authed');
});

test('7b. gateVerdict answers disabled when the gate is not enforced', () => {
  process.env.NODE_ENV = 'development';
  try {
    assert.equal(gateVerdict({ gateCookieValue: undefined }), 'disabled');
  } finally {
    process.env.NODE_ENV = 'production';
  }
  // Production but no slug configured (an ungated fork) is also disabled.
  delete process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE;
  try {
    assert.equal(gateVerdict({ gateCookieValue: undefined }), 'disabled');
  } finally {
    process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE = 'mydemo';
  }
});
