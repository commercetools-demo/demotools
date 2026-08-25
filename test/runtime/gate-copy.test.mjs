// Runtime tests for the access-gate copy.
//
// The gate's whole job is to stop a visitor reading it as an ordinary account
// login: the email is theirs (attribution only, no account exists) and the
// password is ours (shared by everyone with the link). That distinction lives
// only in strings, so it can't be type-checked — these tests pin the parts that
// are load-bearing for comprehension:
//
//   1. Both fields say WHOSE credential they are, on the closed-site render.
//   2. The open-site render says no password is needed and renders no password
//      input at all (asking for a password that doesn't exist is the same
//      confusion in reverse).
//   3. The failure message on a closed site blames the shared password, not the
//      visitor's email — only the password can actually be wrong there.
//   4. The word "username" appears nowhere: there is no username, and that
//      misreading is what started this.
//   5. Per-demo overrides still work, and the legacy `title` prop still wins.
//   6. An evaluation room never calls itself a demo — a prospect opening their
//      own RFP response should not be told it is a demo — while keeping the
//      two-credential explanation, which is what (1)-(4) are actually about.

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

test('closed gate names whose email and whose password each field wants', () => {
  const html = render();
  assert.match(html, /Your email address/);
  assert.match(html, /Shared demo password/);
  // The email hint has to kill "which account do I use?" outright.
  assert.match(html, /no account to create/i);
  // The password hint has to kill "my password doesn't work".
  assert.match(html, /Everyone with access uses the same one/i);
  assert.match(html, /type="password"/);
});

test('open gate says no password is needed and renders no password field', () => {
  const html = render({ open: true });
  assert.match(html, /no password required/i);
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /Shared demo password/);
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
  for (const v of Object.values(EVAL_ROOM_GATE_COPY)) {
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

test('the evaluation-room gate keeps both whose-credential hints', () => {
  const html = render({ siteType: 'content' });
  assert.match(html, /Evaluation room access/);
  assert.match(html, /Shared access password/);
  assert.match(html, /no account to create/i);
  assert.match(html, /Everyone with access uses the same one/i);
  assert.match(html, /type="password"/);
});

test('an open evaluation room asks for no password', () => {
  const html = render({ siteType: 'content', open: true });
  assert.match(html, /no password required/i);
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
