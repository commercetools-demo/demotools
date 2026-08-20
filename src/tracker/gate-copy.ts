// Canonical wording for the demo-tracker access gate.
//
// The gate asks for two things that visitors persistently misread as one
// ordinary login: an email address (THEIR own, used only to attribute the visit
// in reports — there is no account behind it) and a password (OURS, shared by
// everyone who was sent the link). The old copy — "Email" / "Password" /
// "Enter your work email and the site password to continue." — reads exactly
// like a sign-in form for an account the visitor does not have, so people either
// try a password of their own or ask which account to use.
//
// So each field carries an explicit label plus a hint that names whose
// credential it is, and the failure message says which of the two was wrong
// (only the password can be, on a closed site).
//
// This module is deliberately free of React and of any runtime dependency: it is
// the single source of the strings for all THREE gate surfaces, only one of
// which is a React component.
//
//   1. `DemoGate` (this package)                 — app-layer gate, every starter
//      and fork; the majority of demos.
//   2. demo-tracker `src/edge-gate-template.ts`  — the generated Netlify edge
//      function, for edge-gated sites.
//   3. demo-tracker `src/tracker-snippet.ts`     — the `t.js` in-page overlay.
//
// Surfaces 2 and 3 are plain HTML strings built inside the tracker service, so
// they cannot import from here (the tracker is not a React app and pulling this
// package in would drag React peer deps into it). They copy these strings
// verbatim and say so in a comment — this file stays the source of truth. If you
// change wording here, change it there in the same session; nothing else needs
// touching, because no starter or demo overrides any of it.
export interface DemoGateCopy {
  /** Panel heading. */
  title: string;
  /** Sub-heading on a password-protected site. */
  intro: string;
  /** Sub-heading on an open (email-only) site. */
  introOpen: string;
  emailLabel: string;
  emailPlaceholder: string;
  /** Small print under the email field: whose address, and why we want it. */
  emailHint: string;
  passwordLabel: string;
  /** Small print under the password field: it's ours and it's shared. */
  passwordHint: string;
  submit: string;
  /** Client-side email-shape complaint. */
  emailInvalid: string;
  /** Failed submit on a password-protected site. */
  error: string;
  /** Failed submit on an open site (only the email can be at fault). */
  errorOpen: string;
}

export const DEMO_GATE_COPY: DemoGateCopy = {
  title: 'Demo access',
  intro:
    'This demo is shared. Sign in with your own email address, plus the demo password you were given.',
  introOpen: 'This demo just needs your email address — no password required.',
  emailLabel: 'Your email address',
  emailPlaceholder: 'you@company.com',
  emailHint:
    "Any work email. There's no account to create — this just tells us who's viewing the demo.",
  passwordLabel: 'Shared demo password',
  passwordHint:
    'Not one of your own passwords. Everyone with access uses the same one — ask whoever sent you the link.',
  submit: 'Continue',
  emailInvalid: 'Enter a valid email address.',
  error:
    'That demo password is not correct. Everyone uses the same one — check the password you were given.',
  errorOpen: 'That did not work. Check your email address and try again.',
};

/** Merge caller overrides over the defaults. Undefined/empty overrides are ignored. */
export function resolveGateCopy(overrides?: Partial<DemoGateCopy>): DemoGateCopy {
  if (!overrides) return DEMO_GATE_COPY;
  const out = { ...DEMO_GATE_COPY };
  for (const k of Object.keys(overrides) as (keyof DemoGateCopy)[]) {
    const v = overrides[k];
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}
