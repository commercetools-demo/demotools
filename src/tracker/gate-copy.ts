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
// This module is deliberately free of React and of every runtime dependency —
// it is nothing but strings and the type describing them. It is the single
// source of truth for all THREE gate surfaces:
//
//   1. `DemoGate` (this package)                 — app-layer gate, every starter
//      and fork; the majority of demos.
//   2. demo-tracker `src/edge-gate-template.ts`  — the generated Netlify edge
//      function, for edge-gated sites.
//   3. demo-tracker `src/tracker-snippet.ts`     — the `t.js` in-page overlay.
//
// Surfaces 2 and 3 live in the demo-tracker service, which is not a React app.
// They `import` this module directly via the package's React-free
// `@cboyke/demotools/tracker/gate-copy` subpath export — NOT via the
// `./tracker` barrel, which re-exports `DemoGate` and would drag the react /
// react-dom peer deps into a Fastify service. Nothing is copied by hand and no
// starter or demo overrides any of it, so a wording change here reaches every
// surface on the next tracker deploy.
//
// (This previously said the tracker "can't import from here" and told the next
// person to mirror the strings by hand in the same session. That was never
// true — the barrier was only the missing subpath export, and hand-mirroring
// three copies is exactly how they drift.)
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

// A digital evaluation room is not a demo, and the person opening it is a
// prospect evaluating us — often one who was sent the link by their own
// colleague, not by us. "Demo access" on that gate is the first thing they read
// and it mis-frames the whole room, which is a curated response to their RFP
// rather than a sandbox to click around in. Same structure, same two-credential
// explanation (that part is what stops the account-login misreading, and it is
// just as needed here); only the noun changes.
export const EVAL_ROOM_GATE_COPY: DemoGateCopy = {
  title: 'Evaluation room access',
  intro:
    'This room was prepared for your team. Sign in with your own email address, plus the access password you were given.',
  introOpen: 'This room just needs your email address — no password required.',
  emailLabel: 'Your email address',
  emailPlaceholder: 'you@company.com',
  emailHint:
    "Any work email. There's no account to create — this just tells us who's viewing the room.",
  passwordLabel: 'Shared access password',
  passwordHint:
    'Not one of your own passwords. Everyone with access uses the same one — ask whoever sent you the link.',
  submit: 'Continue',
  emailInvalid: 'Enter a valid email address.',
  error:
    'That access password is not correct. Everyone uses the same one — check the password you were given.',
  errorOpen: 'That did not work. Check your email address and try again.',
};

/**
 * The tracker's `sites.site_type`. `content` is an evaluation room or content
 * microsite; `commerce` is a storefront demo. It already decides which admin
 * reports a site gets, so it is the flag that is always set correctly by the
 * time a gate renders — no new column, and a site retyped later self-corrects.
 */
export type GateSiteType = 'content' | 'commerce';

/** Base copy for a site type. Anything that isn't `content` is a demo. */
export function gateCopyForSiteType(siteType?: string | null): DemoGateCopy {
  return siteType === 'content' ? EVAL_ROOM_GATE_COPY : DEMO_GATE_COPY;
}

/** Merge caller overrides over a base set. Undefined/empty overrides are ignored. */
export function resolveGateCopy(
  overrides?: Partial<DemoGateCopy>,
  base: DemoGateCopy = DEMO_GATE_COPY,
): DemoGateCopy {
  if (!overrides) return base;
  const out = { ...base };
  for (const k of Object.keys(overrides) as (keyof DemoGateCopy)[]) {
    const v = overrides[k];
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}
