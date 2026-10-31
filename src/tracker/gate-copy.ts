// Canonical wording for the demo-tracker access gate.
//
// The gate asks for a password (OURS, shared by everyone who was sent the link)
// and offers an unticked consent box. A visitor who ticks it gives an email
// address (THEIR own, with no account behind it) and has the visit recorded; a
// visitor who leaves it unticked gets in on the password alone and nothing about
// them is stored. On an open site there is no password, so the consent choice is
// the whole gate.
//
// So the password carries a hint that names whose credential it is, the box says
// exactly what is recorded and why and links the privacy policy, and the failure
// message says which field was wrong.
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
// `@ct-demos/demotools/tracker/gate-copy` subpath export — NOT via the
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
  /**
   * The consent box's label: what is recorded and why. Shown beside an unticked
   * checkbox, followed by the privacy-policy link.
   */
  consentLabel: string;
  /** Text of the privacy-policy link after the consent label. */
  privacyLabel: string;
  /** Where the privacy-policy link goes. */
  privacyUrl: string;
  emailLabel: string;
  emailPlaceholder: string;
  /** Small print under the email field, shown once the box is ticked. */
  emailHint: string;
  passwordLabel: string;
  /** Small print under the password field: it's ours and it's shared. */
  passwordHint: string;
  submit: string;
  /** Client-side email-shape complaint. */
  emailInvalid: string;
  /** Failed submit on a password-protected site. */
  error: string;
  /** Failed submit on an open site (only a ticked visitor's email can be at fault). */
  errorOpen: string;
}

/** commercetools' privacy policy, linked from every gate's consent box. */
export const PRIVACY_POLICY_URL = 'https://commercetools.com/privacy';

/**
 * The consent box's label. Identical on every surface and every site type: it
 * describes what the tracker records, which does not change with the site.
 */
export const CONSENT_LABEL =
  'Record my visit — my email, the pages I view and my browser — so the commercetools team can follow up.';

export const DEMO_GATE_COPY: DemoGateCopy = {
  title: 'Demo access',
  intro: 'This demo is shared. Enter the demo password you were given.',
  introOpen: 'This demo is open to anyone with the link.',
  consentLabel: CONSENT_LABEL,
  privacyLabel: 'Privacy policy',
  privacyUrl: PRIVACY_POLICY_URL,
  emailLabel: 'Your email address',
  emailPlaceholder: 'you@company.com',
  emailHint:
    "Any work email. There's no account to create — it tells the commercetools team who viewed the demo.",
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
// rather than a sandbox to click around in. Same structure, same whose-credential
// hints and the same consent box; only the noun changes.
export const EVAL_ROOM_GATE_COPY: DemoGateCopy = {
  title: 'Evaluation room access',
  intro: 'This room was prepared for your team. Enter the access password you were given.',
  introOpen: 'This room is open to anyone with the link.',
  consentLabel: CONSENT_LABEL,
  privacyLabel: 'Privacy policy',
  privacyUrl: PRIVACY_POLICY_URL,
  emailLabel: 'Your email address',
  emailPlaceholder: 'you@company.com',
  emailHint:
    "Any work email. There's no account to create — it tells the commercetools team who viewed the room.",
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

// What the consent box says is recorded, and where the privacy policy lives,
// are not a demo's to reword: the label is what the visitor agreed to.
const FIXED_KEYS: ReadonlySet<keyof DemoGateCopy> = new Set(['consentLabel', 'privacyUrl']);

/**
 * Merge caller overrides over a base set. Undefined/empty overrides are ignored,
 * and so is any override of the consent label or the privacy-policy URL.
 */
export function resolveGateCopy(
  overrides?: Partial<DemoGateCopy>,
  base: DemoGateCopy = DEMO_GATE_COPY,
): DemoGateCopy {
  if (!overrides) return base;
  const out = { ...base };
  for (const k of Object.keys(overrides) as (keyof DemoGateCopy)[]) {
    if (FIXED_KEYS.has(k)) continue;
    const v = overrides[k];
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}
