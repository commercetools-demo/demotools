// Runtime tests for the access-gate copy.
//
// The gate asks for a password that is ours (shared by everyone with the link)
// and offers an unticked consent box; the email is theirs, asked for only once
// they tick it, and buys them nothing but attribution. That lives only in
// strings and markup, so it can't be type-checked — these tests pin the parts
// that are load-bearing:
//
//   1. The password says WHOSE credential it is, the box is there and unticked
//      with the agreed label and the privacy link, and no email field renders
//      until the box is ticked.
//   2. The open-site render renders no password input at all, and can be
//      submitted as it stands — the visitor gets in on the consent choice.
//   3. The failure message on a closed site blames the shared password, not the
//      visitor's email — only the password can actually be wrong there.
//   4. The word "username" appears nowhere: there is no username, and that
//      misreading is what started this.
//   5. Per-demo overrides still work, and the legacy `title` prop still wins.
//   6. An evaluation room never calls itself a demo — a prospect opening their
//      own RFP response should not be told it is a demo — while keeping the
//      whose-credential hint and the consent box, which (1)-(4) are about.
//   7. No demo can reword the consent label or move the privacy link.
//   8. The data note sits under the box on every gate, links the tracker's
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
  'Record my visit — my email, the pages I view and my browser — so the commercetools team can follow up.';
const DATA_NOTE = 'GDPR compliant · stored in the EU · download or erase it any time';

/** The consent checkbox's own tag. */
const checkbox = (html) => html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? '';

test('closed gate: whose password, an unticked consent box, no email until ticked', () => {
  const html = render();
  assert.match(html, /Shared demo password/);
  // The password hint has to kill "my password doesn't work".
  assert.match(html, /Everyone with access uses the same one/i);
  assert.match(html, /type="password"/);

  const box = checkbox(html);
  assert.match(box, /name="consent"/);
  assert.match(box, /value="on"/);
  assert.doesNotMatch(box, /checked/, 'the box is never ticked for the visitor');
  assert.ok(html.includes(CONSENT), 'the consent label is the agreed wording');
  assert.match(html, /href="https:\/\/commercetools\.com\/privacy"/);
  assert.match(html, />Privacy policy</);

  // No email field — and so no email in the form post — without the tick.
  assert.doesNotMatch(html, /type="email"/);
  assert.doesNotMatch(html, /name="email"/);
});

test('the email hint says there is no account behind the address', () => {
  // Shown once the box is ticked; it has to kill "which account do I use?".
  assert.match(DEMO_GATE_COPY.emailHint, /no account to create/i);
  assert.match(EVAL_ROOM_GATE_COPY.emailHint, /no account to create/i);
});

test('open gate renders no password field and can be submitted untouched', () => {
  const html = render({ open: true });
  assert.match(html, /open to anyone with the link/i);
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /Shared demo password/);
  assert.doesNotMatch(checkbox(html), /checked/);
  const button = html.match(/<button[^>]*>/)[0];
  assert.doesNotMatch(button, /disabled/, 'an open site lets the visitor in on the consent choice alone');
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
  assert.equal(copy.dataUrl, 'https://tracker.ctdemo.net/privacy');
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
  const copy = resolveGateCopy({ title: 'Acme preview', emailHint: '', passwordLabel: undefined });
  assert.equal(copy.title, 'Acme preview');
  assert.equal(copy.emailHint, DEMO_GATE_COPY.emailHint);
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
  // Link targets are not read: the tracker's own host is ctdemo.net.
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

test('the evaluation-room gate keeps the whose-credential hint and the box', () => {
  const html = render({ siteType: 'content' });
  assert.match(html, /Evaluation room access/);
  assert.match(html, /Shared access password/);
  assert.match(html, /Everyone with access uses the same one/i);
  assert.match(html, /type="password"/);
  assert.ok(html.includes(CONSENT));
  assert.doesNotMatch(checkbox(html), /checked/);
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
