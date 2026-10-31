'use client';

import { useEffect, useState } from 'react';
import {
  type DemoGateCopy,
  type GateSiteType,
  gateCopyForSiteType,
  resolveGateCopy,
} from './gate-copy.js';

// Simple but real email shape check — a local part, an @, and a dotted domain
// whose TLD is at least two chars. Catches "a@b" / "a@b." client-side instead
// of round-tripping to the server for a generic error.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface DemoGateProps {
  /** Where the gate sends the visitor once access is granted. */
  homePath: string;
  /**
   * "Open" site: no password. The visitor gets in on the consent choice alone.
   * Determined server-side via `siteIsOpen()` and passed in by the /gate page.
   * Defaults to a closed site (password required).
   */
  open?: boolean;
  /** POST target for the native form. Defaults to `/api/gate`. */
  action?: string;
  /** Panel heading. Shorthand for `copy.title`. Defaults to "Demo access". */
  title?: string;
  /**
   * Which base wording to start from. `content` gets the evaluation-room set
   * ("Evaluation room access"), anything else gets the demo set. Pass the
   * tracker's `sites.site_type` straight through; the edge and `t.js` gates
   * select the same way, so all three surfaces agree.
   */
  siteType?: GateSiteType;
  /**
   * Per-demo wording overrides, merged over the base chosen by `siteType`.
   * Anything omitted falls back to that base — which is what every demo should
   * normally use, since the defaults are the whole point (see `gate-copy.ts`).
   */
  copy?: Partial<DemoGateCopy>;
  /** Backdrop CSS background. Defaults to a light neutral. */
  background?: string;
  /** Primary button / accent color. Defaults to `#0f172a`. */
  accent?: string;
}

const HINT_STYLE: React.CSSProperties = {
  color: '#6b7280',
  fontSize: 13,
  lineHeight: 1.45,
  marginTop: 6,
};

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: 15,
  fontWeight: 600,
  color: '#333',
  margin: '18px 0 6px',
};

/**
 * Full-screen password gate rendered by the /gate route, with an unticked
 * consent box. The visitor ticks it to have the visit recorded, and only then
 * is the email field shown and sent; a visitor who leaves it unticked gets in
 * on the password alone (on an open site, on nothing at all) and the tracker
 * stores nothing about them. Nothing ticks the box but the visitor.
 *
 * Submits as a NATIVE
 * top-level form POST to `action` (NOT fetch) — a top-level navigation carries
 * a SameSite=Lax cookie even when initiated from another app (e.g. a tap in
 * Messages), whereas a fetch from a freshly cold-opened tab might not. The gate
 * route validates the credentials, sets the first-party gate cookie on a 303
 * redirect, and sends the visitor into the storefront.
 *
 * The password is ours and is shared by everyone with the link; the email is
 * the visitor's own and buys them nothing but attribution. See
 * [`gate-copy.ts`](./gate-copy.ts) for the wording and why.
 *
 * Rendered as a fixed full-screen overlay. Light theme by default; pass
 * `background` / `accent` (or fork) to rebrand per demo.
 */
export default function DemoGate({
  homePath,
  open = false,
  action = '/api/gate',
  title,
  siteType,
  copy,
  background = '#f4f4f5',
  accent = '#0f172a',
}: DemoGateProps) {
  const t = resolveGateCopy(
    title ? { ...copy, title } : copy,
    gateCopyForSiteType(siteType),
  );

  // Read the `?gate_error=1` param client-side (this is a 'use client'
  // component rendered under a force-dynamic route). Done via window.location
  // rather than next/navigation's useSearchParams so the library carries no
  // `next` build dependency.
  const [error, setError] = useState(false);
  useEffect(() => {
    setError(new URLSearchParams(window.location.search).has('gate_error'));
  }, []);

  // Live client-side validation so the visitor gets feedback as they type,
  // rather than only a generic error after a full-page POST round-trip.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  // Unticked until the visitor ticks it. Never defaulted, restored or inferred.
  const [consent, setConsent] = useState(false);

  const emailValid = EMAIL_RE.test(email.trim());
  const showEmailError = consent && emailTouched && email.trim().length > 0 && !emailValid;
  const canSubmit = (open || password.length > 0) && (!consent || emailValid);

  useEffect(() => {
    // ITP insurance: if the gate cookie exists but a cross-app navigation
    // arrived without it (Safari withholds a Strict-rewritten cookie on a
    // top-level nav from another app), a same-site client navigation from /gate
    // DOES carry it. Check auth and, if already signed in, go to the site.
    // Guarded against loops with a one-shot sessionStorage flag.
    if (sessionStorage.getItem('demo_gate_heal') === '1') return;
    fetch(action, { cache: 'no-store', credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.authed) {
          sessionStorage.setItem('demo_gate_heal', '1');
          window.location.replace(homePath);
        }
      })
      .catch(() => {});
  }, [homePath, action]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background,
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        color: '#1a1a1a',
        padding: 16,
        overflowY: 'auto',
      }}
    >
      <form
        method="POST"
        action={action}
        onSubmit={(e) => {
          // Guard the native POST: block it (and reveal the inline hint) when
          // the password is empty, or the box is ticked and the email malformed.
          // Valid submits fall through to the real top-level POST so the
          // SameSite cookie still rides.
          if (!canSubmit) {
            e.preventDefault();
            setEmailTouched(true);
          }
        }}
        style={{
          background: '#fff',
          border: '1px solid #e5e5e5',
          borderRadius: 14,
          padding: 32,
          maxWidth: 440,
          width: '100%',
          boxSizing: 'border-box',
          boxShadow: '0 10px 30px rgba(0,0,0,.08)',
          margin: 'auto',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 800, color: '#0f172a' }}>
          {t.title}
        </h2>
        <p style={{ margin: 0, color: '#555', fontSize: 15, lineHeight: 1.5 }}>
          {open ? t.introOpen : t.intro}
        </p>
        {!open && (
          <>
            <label htmlFor="demo-gate-password" style={LABEL_STYLE}>
              {t.passwordLabel}
            </label>
            <input
              id="demo-gate-password"
              type="password"
              name="password"
              required
              autoComplete="current-password"
              aria-describedby="demo-gate-password-hint"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 14px',
                border: '2px solid #d0d0d8',
                borderRadius: 8,
                fontSize: 16,
                boxSizing: 'border-box',
              }}
            />
            <div id="demo-gate-password-hint" style={HINT_STYLE}>
              {t.passwordHint}
            </div>
          </>
        )}
        <label
          htmlFor="demo-gate-consent"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            margin: '20px 0 0',
            fontSize: 14,
            lineHeight: 1.45,
            color: '#333',
            cursor: 'pointer',
          }}
        >
          <input
            id="demo-gate-consent"
            type="checkbox"
            name="consent"
            value="on"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            style={{ marginTop: 3, width: 16, height: 16, flex: 'none', accentColor: accent }}
          />
          <span>
            {t.consentLabel}{' '}
            <a
              href={t.privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: accent, textDecoration: 'underline' }}
            >
              {t.privacyLabel}
            </a>
          </span>
        </label>
        {consent && (
          <>
            <label htmlFor="demo-gate-email" style={LABEL_STYLE}>
              {t.emailLabel}
            </label>
            <input
              id="demo-gate-email"
              type="email"
              name="email"
              required
              autoFocus
              autoComplete="email"
              inputMode="email"
              placeholder={t.emailPlaceholder}
              value={email}
              aria-invalid={showEmailError}
              aria-describedby="demo-gate-email-hint"
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              style={{
                width: '100%',
                padding: '12px 14px',
                border: `2px solid ${showEmailError ? '#c0392b' : '#d0d0d8'}`,
                borderRadius: 8,
                fontSize: 16,
                boxSizing: 'border-box',
              }}
            />
            <div id="demo-gate-email-hint" style={HINT_STYLE}>
              {t.emailHint}
            </div>
            <div style={{ color: '#c0392b', fontSize: 13, minHeight: '1.1em', marginTop: 4 }}>
              {showEmailError ? t.emailInvalid : ''}
            </div>
          </>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            marginTop: 24,
            width: '100%',
            padding: 14,
            background: accent,
            color: '#fff',
            border: 0,
            borderRadius: 8,
            fontSize: 18,
            fontWeight: 700,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: canSubmit ? 1 : 0.5,
          }}
        >
          {t.submit}
        </button>
        {error && (
          <div
            role="alert"
            style={{ color: '#c0392b', fontSize: 14, lineHeight: 1.45, marginTop: 12 }}
          >
            {open ? t.errorOpen : t.error}
          </div>
        )}
      </form>
    </div>
  );
}
