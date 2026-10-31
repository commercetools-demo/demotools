// Runtime tests for the access-gate copy.
//
// The gate asks for a password that is ours (shared by everyone with the link)
// and offers an optional email field; the email is theirs, typing it is the
// opt-in, and it buys them nothing but attribution. That lives only in strings
// and markup, so it can't be type-checked — these tests pin the parts that are
// load-bearing:
//
//   1. The password says WHOSE credential it is, the email field is there,
//      empty, optional and labelled as such, with the agreed consent label and
//      the privacy link under it, and there is no checkbox.
//   2. The open-site render renders no password input at all, and can be
//      submitted as it stands — the visitor gets in without an email.
//   3. The failure message on a closed site blames the shared password, not the
//      visitor's email — only the password can actually be wrong there.
//   4. The word "username" appears nowhere: there is no username, and that
//      misreading is what started this.
//   5. Per-demo overrides still work, and the legacy `title` prop still wins.
//   6. An evaluation room never calls itself a demo — a prospect opening their
//      own RFP response should not be told it is a demo — while keeping the
//      whose-credential hint and the consent label, which (1)-(4) are about.
//   7. No demo can reword the consent label or move the privacy link.
//   8. The data note sits under the consent label on every gate, links the tracker's
//      privacy page, and no demo can reword it or move the link.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import DemoGate from '../../dist/tracker/DemoGate.js';
import {
  DEMO_GATE_COPY,
  EVAL_ROOM_GATE_COPY,
  gateCopyForSiteType,
  resolveGateCopy,
} from '../../dist/tracker/gate-copy.js';

const render = (props) =>
  renderToStaticMarkup(React.createElement(DemoGate, { homePath: '/en-us', ...props }));

const CONSENT =
  'Enter it to record your visit — your email, the pages you view and your browser — so the commercetools team can follow up. Leave it blank and nothing about you is stored.';
const DATA_NOTE = 'GDPR compliant · stored in the EU · download or erase it any time';

/** The email field's own tag. */
const emailInput = (html) => html.match(/<input[^>]*type="email"[^>]*>/)?.[0] ?? '';

/** Asserts the email field is the opt-in: present, empty, optional, no checkbox. */
function assertEmailIsTheOptIn(html) {
  const input = emailInput(html);
  assert.match(input, /name="email"/);
  assert.doesNotMatch(input, /required/, 'a blank email is a valid answer');
  assert.doesNotMatch(input, /value="[^"]/, 'the field starts empty');
  assert.doesNotMatch(html, /type="checkbox"/, 'the email field is the only opt-in');
  assert.match(html, /Your email address \(optional\)/);
  assert.ok(html.includes(CONSENT), 'the consent label is the agreed wording');
  assert.match(html, /href="https:\/\/commercetools\.com\/privacy"/);
  assert.match(html, />Privacy policy</);
}

test('closed gate: whose password, then an optional email with the consent label', () => {
  const html = render();
  assert.match(html, /Shared demo password/);
  // The password hint has to kill "my password doesn't work".
  assert.match(html, /Everyone with access uses the same one/i);
  assert.match(html, /type="password"/);
  assertEmailIsTheOptIn(html);
  // The consent label is the field's description, so a screen reader reads it.
  assert.match(emailInput(html), /aria-describedby="demo-gate-consent demo-gate-data-note"/);
});

test('the consent label says what giving the email records, and what a blank one does', () => {
  assert.match(CONSENT, /^Enter it to record your visit/);
  assert.match(CONSENT, /Leave it blank and nothing about you is stored\.$/);
});

test('open gate renders no password field and can be submitted untouched', () => {
  const html = render({ open: true });
  assert.match(html, /open to anyone with the link/i);
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /Shared demo password/);
  assertEmailIsTheOptIn(html);
  const button = html.match(/<button[^>]*>/)[0];
  assert.doesNotMatch(button, /disabled/, 'an open site lets the visitor in without an email');
});

test('closed gate cannot be submitted without the password', () => {
  assert.match(render().match(/<button[^>]*>/)[0], /disabled/);
});

test('no demo can reword the consent label or move the privacy link', () => {
  const copy = resolveGateCopy({ consentLabel: 'Track me', privacyUrl: 'https://example.com', privacyLabel: 'Datenschutz' });
  assert.equal(copy.consentLabel, CONSENT);
  assert.equal(copy.privacyUrl, 'https://commercetools.com/privacy');
  // The link text is only a label, so it can be translated.
  assert.equal(copy.privacyLabel, 'Datenschutz');
  assert.equal(EVAL_ROOM_GATE_COPY.consentLabel, CONSENT);
});

test('no demo can reword the data note or move the data-page link', () => {
  const copy = resolveGateCopy({ dataNotice: 'We keep it forever', dataUrl: 'https://example.com', dataLabel: 'Ihre Daten' });
  assert.equal(copy.dataNotice, DATA_NOTE);
  assert.equal(copy.dataUrl, 'https://tracker.ct-builders.ai/privacy');
  assert.equal(copy.dataLabel, 'Ihre Daten');
  assert.equal(EVAL_ROOM_GATE_COPY.dataNotice, DATA_NOTE);
  for (const html of [render({ open: true }), render({ siteType: 'content' })]) {
    assert.ok(html.includes(DATA_NOTE));
  }
});

test('no gate surface ever says "username"', () => {
  for (const html of [render(), render({ open: true })]) {
    assert.doesNotMatch(html, /username/i);
  }
  for (const v of Object.values(DEMO_GATE_COPY)) {
    assert.doesNotMatch(v, /username/i);
  }
});

test('the closed-site failure message blames the shared password, not the email', () => {
  // `?gate_error=1` is read in an effect, so drive the copy directly: the point
  // is that the two messages differ and that the closed one is about the
  // password everyone shares.
  assert.match(DEMO_GATE_COPY.error, /demo password/i);
  assert.match(DEMO_GATE_COPY.error, /same one/i);
  assert.doesNotMatch(DEMO_GATE_COPY.error, /email/i);
  assert.match(DEMO_GATE_COPY.errorOpen, /email/i);
});

test('overrides merge over the defaults; blanks and omissions fall back', () => {
  const copy = resolveGateCopy({ title: 'Acme preview', passwordHint: '', passwordLabel: undefined });
  assert.equal(copy.title, 'Acme preview');
  assert.equal(copy.passwordHint, DEMO_GATE_COPY.passwordHint);
  assert.equal(copy.passwordLabel, DEMO_GATE_COPY.passwordLabel);
  assert.equal(resolveGateCopy(), DEMO_GATE_COPY);
});

test('the legacy `title` prop still sets the heading', () => {
  assert.match(render({ title: 'Deckers B2B demo' }), /Deckers B2B demo/);
  // …and beats a title inside `copy`, since it is the narrower, older API.
  assert.match(render({ title: 'Wins', copy: { title: 'Loses' } }), /Wins/);
});

test('site_type picks the base copy; only `content` is an evaluation room', () => {
  assert.equal(gateCopyForSiteType('content'), EVAL_ROOM_GATE_COPY);
  assert.equal(gateCopyForSiteType('commerce'), DEMO_GATE_COPY);
  // Anything unset/unknown is a demo — the safer default, since a storefront
  // called an "evaluation room" is stranger than the reverse.
  assert.equal(gateCopyForSiteType(undefined), DEMO_GATE_COPY);
  assert.equal(gateCopyForSiteType(null), DEMO_GATE_COPY);
  assert.equal(gateCopyForSiteType('something-new'), DEMO_GATE_COPY);
});

// Visible text only. The markup carries internal ids like `demo-gate-email`,
// which no visitor reads and which consumer CSS may key off — the claim under
// test is about what the gate SAYS, so strip the tags before asserting.
const visibleText = (html) => html.replace(/<[^>]*>/g, ' ');

test('the evaluation-room gate never says "demo"', () => {
  // Link targets are not visible copy, so they are not read.
  for (const [k, v] of Object.entries(EVAL_ROOM_GATE_COPY)) {
    if (k.endsWith('Url')) continue;
    assert.doesNotMatch(v, /demo/i);
  }
  for (const html of [
    render({ siteType: 'content' }),
    render({ siteType: 'content', open: true }),
  ]) {
    assert.doesNotMatch(visibleText(html), /demo/i);
    assert.doesNotMatch(visibleText(html), /username/i);
  }
});

test('the demo gate still says "demo" — the variant did not become the default', () => {
  // Guards the inverse mistake: flipping the base would silently re-label every
  // storefront demo as an evaluation room.
  assert.match(visibleText(render()), /demo/i);
  assert.match(visibleText(render({ siteType: 'commerce' })), /demo/i);
});

test('the evaluation-room gate keeps the whose-credential hint and the opt-in', () => {
  const html = render({ siteType: 'content' });
  assert.match(html, /Evaluation room access/);
  assert.match(html, /Shared access password/);
  assert.match(html, /Everyone with access uses the same one/i);
  assert.match(html, /type="password"/);
  assertEmailIsTheOptIn(html);
});

test('an open evaluation room asks for no password', () => {
  const html = render({ siteType: 'content', open: true });
  assert.match(html, /open to anyone with the link/i);
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /Shared access password/);
});

test('overrides merge over the evaluation-room base, not the demo one', () => {
  const copy = resolveGateCopy({ title: 'IFF x commercetools' }, EVAL_ROOM_GATE_COPY);
  assert.equal(copy.title, 'IFF x commercetools');
  // The rest must come from the room set, not leak back to "Shared demo password".
  assert.equal(copy.passwordLabel, EVAL_ROOM_GATE_COPY.passwordLabel);
  assert.equal(resolveGateCopy(undefined, EVAL_ROOM_GATE_COPY), EVAL_ROOM_GATE_COPY);
});

test('the two sets stay structurally identical', () => {
  // A key added to one and forgotten in the other renders as undefined.
  assert.deepEqual(
    Object.keys(EVAL_ROOM_GATE_COPY).sort(),
    Object.keys(DEMO_GATE_COPY).sort(),
  );
  for (const [k, v] of Object.entries(EVAL_ROOM_GATE_COPY)) {
    assert.equal(typeof v, 'string', k);
    assert.ok(v.length > 0, k);
  }
});
