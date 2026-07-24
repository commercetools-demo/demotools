/**
 * HMAC key for a storefront's session JWT, resolved once at module load.
 *
 * In production SESSION_SECRET is MANDATORY: we refuse to fall back to the
 * built-in dev key, because that key is public (shipped in this package / the
 * fork) — a deploy that forgot to set SESSION_SECRET would sign and verify
 * sessions with a publicly-known secret, letting anyone forge a session cookie
 * (arbitrary customerId/email) and impersonate any customer. Failing fast at
 * startup is far safer than silently shipping that. Local dev keeps a stable
 * fallback so the app runs without setup.
 *
 * Only reads process.env + uses TextEncoder, both available in the edge runtime,
 * so the storefront's server code AND its proxy/middleware can share one key and
 * never drift onto different secrets.
 */
export function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (secret) return new TextEncoder().encode(secret);
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET is not set. Refusing to sign/verify sessions with a built-in ' +
        'fallback key in production — set SESSION_SECRET in the deploy environment.'
    );
  }
  return new TextEncoder().encode('fallback-secret-change-me-in-production!!');
}
