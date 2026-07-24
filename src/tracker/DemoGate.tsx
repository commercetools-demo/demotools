'use client';

import { useEffect, useState } from 'react';

// Simple but real email shape check — a local part, an @, and a dotted domain
// whose TLD is at least two chars. Catches "a@b" / "a@b." client-side instead
// of round-tripping to the server for a generic error.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface DemoGateProps {
  /** Where the gate sends the visitor once access is granted. */
  homePath: string;
  /**
   * "Open" (email-only) site: collect a work email but no password. Determined
   * server-side via `siteIsOpen()` and passed in by the /gate page. Defaults to
   * a closed site (password required).
   */
  open?: boolean;
  /** POST target for the native form. Defaults to `/api/gate`. */
  action?: string;
  /** Panel heading. Defaults to "Demo access". */
  title?: string;
  /** Backdrop CSS background. Defaults to a light neutral. */
  background?: string;
  /** Primary button / accent color. Defaults to `#0f172a`. */
  accent?: string;
}

/**
 * Full-screen password gate rendered by the /gate route. Submits as a NATIVE
 * top-level form POST to `action` (NOT fetch) — a top-level navigation carries
 * a SameSite=Lax cookie even when initiated from another app (e.g. a tap in
 * Messages), whereas a fetch from a freshly cold-opened tab might not. The gate
 * route validates the credentials, sets the first-party gate cookie on a 303
 * redirect, and sends the visitor into the storefront.
 *
 * Rendered as a fixed full-screen overlay. Light theme by default; pass
 * `background` / `accent` (or fork) to rebrand per demo.
 */
export default function DemoGate({
  homePath,
  open = false,
  action = '/api/gate',
  title = 'Demo access',
  background = '#f4f4f5',
  accent = '#0f172a',
}: DemoGateProps) {
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

  const emailValid = EMAIL_RE.test(email.trim());
  const showEmailError = emailTouched && email.trim().length > 0 && !emailValid;
  const canSubmit = emailValid && (open || password.length > 0);

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
      }}
    >
      <form
        method="POST"
        action={action}
        onSubmit={(e) => {
          // Guard the native POST: block it (and reveal the inline hint) when
          // the email is malformed or the password is empty. Valid submits fall
          // through to the real top-level POST so the SameSite cookie still rides.
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
          maxWidth: 420,
          width: '100%',
          boxSizing: 'border-box',
          boxShadow: '0 10px 30px rgba(0,0,0,.08)',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 800, color: '#0f172a' }}>
          {title}
        </h2>
        <p style={{ margin: '0 0 20px', color: '#555', fontSize: 16 }}>
          {open
            ? 'Enter your work email to continue.'
            : 'Enter your work email and the site password to continue.'}
        </p>
        <label
          htmlFor="demo-gate-email"
          style={{
            display: 'block',
            fontSize: 15,
            fontWeight: 600,
            color: '#333',
            margin: '12px 0 6px',
          }}
        >
          Email
        </label>
        <input
          id="demo-gate-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          aria-invalid={showEmailError}
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
        <div style={{ color: '#c0392b', fontSize: 13, minHeight: '1.1em', marginTop: 4 }}>
          {showEmailError ? 'Enter a valid email address.' : ''}
        </div>
        {!open && (
          <>
            <label
              htmlFor="demo-gate-password"
              style={{
                display: 'block',
                fontSize: 15,
                fontWeight: 600,
                color: '#333',
                margin: '12px 0 6px',
              }}
            >
              Password
            </label>
            <input
              id="demo-gate-password"
              type="password"
              name="password"
              required
              autoComplete="current-password"
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
          </>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            marginTop: 20,
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
          Continue
        </button>
        {error && (
          <div style={{ color: '#c0392b', fontSize: 14, marginTop: 10 }}>
            Invalid email or password. Please try again.
          </div>
        )}
      </form>
    </div>
  );
}
