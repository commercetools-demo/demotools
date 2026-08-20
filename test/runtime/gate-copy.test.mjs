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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import DemoGate from '../../dist/tracker/DemoGate.js';
import { DEMO_GATE_COPY, resolveGateCopy } from '../../dist/tracker/gate-copy.js';

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
