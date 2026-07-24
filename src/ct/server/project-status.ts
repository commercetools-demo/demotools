// ── commercetools project "trial expired" detection ──────────────────────────
// When a CT project's trial expires, the OAuth token endpoint stops issuing
// tokens: every credentials-flow request returns HTTP 400 with
// `error: "invalid_scope"` and a message like
//   "The trial of project 'demo-cintas' has expired"
// Because this fails at the *token* step, EVERY storefront API call throws —
// catalog, cart, login, project settings — so the app would otherwise 500 on
// every page (and hang for the function timeout while the SDK retries).
//
// Detect the condition, cache it (throttled probe), and let the layout render
// <ProjectExpiredBanner> + the error boundary render a clear message instead of
// an opaque 500. Self-contained: reads the standard CTP_* env vars directly, so
// it has no dependency on the app's CT client.

let projectExpired = false;
let lastProbeAt = 0;
const PROBE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;

/**
 * True if `err` is the commercetools "trial of project … has expired" auth
 * failure. Handles both a raw OAuth JSON body and an SDK-thrown error wrapper,
 * anchoring on the message text ("has expired") since the `invalid_scope` code
 * is also used for unrelated scope problems.
 */
export function isProjectExpiredError(err: unknown): boolean {
  const e = err as {
    error?: string;
    error_description?: string;
    message?: string;
    body?: {
      error?: string;
      error_description?: string;
      message?: string;
      errors?: Array<{ code?: string; message?: string }>;
    };
  };
  const text = [
    e?.error,
    e?.error_description,
    e?.message,
    e?.body?.error,
    e?.body?.error_description,
    e?.body?.message,
    e?.body?.errors?.[0]?.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return text.includes('has expired') && (text.includes('trial') || text.includes('project'));
}

/** Fast, no-network: whether the project is currently believed to be expired. */
export function isProjectExpired(): boolean {
  return projectExpired;
}

/**
 * Flip the cached flag if `err` is the trial-expired auth error. Call from any
 * CT call site that catches an error and wants to degrade gracefully rather
 * than rethrow. Returns whether the flag was set.
 */
export function markProjectExpiredFromError(err: unknown): boolean {
  if (isProjectExpiredError(err)) {
    projectExpired = true;
    lastProbeAt = Date.now();
    return true;
  }
  return false;
}

/**
 * Probe the OAuth token endpoint directly with the storefront's own scopes so
 * the layout can decide whether to show the trial-expired banner on every page.
 * Reproduces exactly what the SDK does on its first call, but bounded by a
 * timeout and throttled to once per minute per worker so it can't hang renders.
 * Returns true when the project can still issue tokens.
 *
 * Reads CTP_AUTH_URL / CTP_PROJECT_KEY / CTP_CLIENT_ID / CTP_CLIENT_SECRET /
 * CTP_SCOPES from the environment (the same vars the app's CT client uses).
 */
export async function checkProjectActive(): Promise<boolean> {
  const now = Date.now();
  if (now - lastProbeAt < PROBE_TTL_MS) return !projectExpired;
  lastProbeAt = now;

  const authUrl = process.env.CTP_AUTH_URL;
  const projectKey = process.env.CTP_PROJECT_KEY;
  const clientId = process.env.CTP_CLIENT_ID;
  const clientSecret = process.env.CTP_CLIENT_SECRET;
  const scopes = process.env.CTP_SCOPES ?? (projectKey ? `manage_project:${projectKey}` : '');
  // The app's CT client already throws on missing creds at module load; bail
  // quietly here rather than duplicate that failure.
  if (!authUrl || !clientId || !clientSecret) return !projectExpired;

  try {
    const res = await fetch(`${authUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(scopes)}`,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (res.ok) {
      projectExpired = false;
      return true;
    }
    const data = await res.json().catch(() => ({}));
    if (isProjectExpiredError(data)) {
      projectExpired = true;
      return false;
    }
    // Some other auth failure (bad scope, revoked client, transient 5xx). Don't
    // flip the expiry flag — the real call site will surface that error.
    return !projectExpired;
  } catch {
    // Network error / timeout — leave the flag as-is.
    return !projectExpired;
  }
}
