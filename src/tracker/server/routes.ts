// Next.js App Router route factories for the demo-tracker: the first-party
// proxy (`/api/tracker/[...path]`) and the password-gate auth route (`/api/gate`).
//
// Like the chat/server factories, these take/return the standard Fetch
// Request/Response and never import `next` — so a demo's route file is a
// one-liner:
//
//   // site/app/api/tracker/[...path]/route.ts
//   import { createTrackerProxyRoute } from '@cboyke/demotools/tracker/server';
//   const handler = createTrackerProxyRoute({ mode: 'gated' });
//   export const GET = handler, POST = handler, PUT = handler,
//     PATCH = handler, DELETE = handler, OPTIONS = handler;
//   export const dynamic = 'force-dynamic';
//
//   // site/app/api/gate/route.ts
//   import { createGateRoute } from '@cboyke/demotools/tracker/server';
//   import { GATE_HOME_PATH } from '@/lib/gate';
//   export const { GET, POST } = createGateRoute({ homePath: GATE_HOME_PATH });
//   export const dynamic = 'force-dynamic';

import { GATE_COOKIE, TRACKER_BASE_PATH, TRACKER_COOKIE, gateSlug, trackerOrigin } from '../config.js';

// Handlers take the global `Request`, NOT a structural subset of it.
//
// A hand-rolled `interface RequestLike { method; url; headers; ... }` type-checks
// everywhere except the one place that matters. Next's route validator (generated
// by next-types-plugin) does not ask whether the handler ACCEPTS a Request — it
// reads the declared first-argument type and requires it to extend
// `Request | NextRequest`:
//
//   Diff<ParamCheck<Request | NextRequest>, { __param_type__: FirstArg<GET> }>
//
// A structural subset fails that: Request extends RequestLike, not the reverse.
// So `export const { GET, POST } = createGateRoute(...)` broke b2c-starter's build
// with `Type "RequestLike" is not a valid type for the function's first argument`
// while `tsc --noEmit` stayed green — ordinary assignability is bivariant on
// parameters, so every other check passed. See test/route-types.ts, which
// reproduces the validator's constraint. Fixed 2026-08-10.
//
// `Request` is a global from the consumer's own lib, so this still imports
// nothing from `next` — the reason the subset existed in the first place.

// The tracker's dt_session is an HS256 JWT: 3 base64url segments. We forward
// ONLY a value of this shape (never the '1' presence-marker or anything else).
const JWT_RE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(/; */)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k) out[k] = part.slice(eq + 1).trim();
  }
  return out;
}

export interface TrackerProxyOptions {
  /**
   * `'gated'` (default): the app runs its own password gate. Authenticate the
   * tracker server-side from the gate session — the gate stores the tracker's
   * `dt_session` JWT as the `demo_gate` cookie value; forward that as the
   * tracker's cookie so `t.js`'s probe returns 200. The browser is never given
   * a `dt_session` cookie (keeps it ITP-immune), so relayed Set-Cookie is
   * stripped on every path except `/auth`.
   *
   * `'track-only'`: no app gate. Forward the tracker's own anonymous
   * `dt_session` cookie and let its Set-Cookie through so the first-party
   * session persists.
   *
   * Both modes strip the storefront's own cookies (never leaked to the tracker
   * origin) and drop `content-encoding`/`content-length` (fetch already decoded
   * the body — leaving them would make the browser try to decode plaintext).
   */
  mode?: 'gated' | 'track-only';
  /** Mount path to strip when deriving the upstream path. Defaults to `/api/tracker`. */
  basePath?: string;
  /** Override the tracker origin. Defaults to `trackerOrigin()`. */
  origin?: () => string;
}

export function createTrackerProxyRoute(
  opts: TrackerProxyOptions = {},
): (req: Request) => Promise<Response> {
  const mode = opts.mode ?? 'gated';
  const basePath = opts.basePath ?? TRACKER_BASE_PATH;
  const getOrigin = opts.origin ?? trackerOrigin;

  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const upstreamPath = url.pathname.startsWith(basePath)
      ? url.pathname.slice(basePath.length)
      : url.pathname;
    const upstreamUrl = `${getOrigin()}${upstreamPath}${url.search}`;

    const headers = new Headers(req.headers);
    headers.delete('host');
    headers.delete('connection');
    headers.delete('content-length');

    const cookies = parseCookies(req.headers.get('cookie'));
    if (mode === 'gated') {
      const gate = cookies[GATE_COOKIE];
      if (gate && JWT_RE.test(gate)) headers.set('cookie', `${TRACKER_COOKIE}=${gate}`);
      else headers.delete('cookie');
    } else {
      const dt = cookies[TRACKER_COOKIE];
      if (dt) headers.set('cookie', `${TRACKER_COOKIE}=${dt}`);
      else headers.delete('cookie');
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    try {
      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: hasBody ? await req.arrayBuffer() : undefined,
        redirect: 'manual',
      });
      const respHeaders = new Headers(upstream.headers);
      // fetch() already decoded the body — leaving these would make the browser
      // try to decode already-plaintext bytes and corrupt the response.
      respHeaders.delete('content-encoding');
      respHeaders.delete('content-length');
      if (mode === 'gated' && upstreamPath.replace(/^\//, '') !== 'auth') {
        respHeaders.delete('set-cookie');
      }
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: respHeaders,
      });
    } catch {
      return new Response(JSON.stringify({ error: 'tracker upstream unreachable' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
  };
}

export interface GateRouteOptions {
  /** Where a granted visitor is sent (default-locale home, e.g. `/en-us`). */
  homePath: string;
  /** Where a failed auth redirects. Defaults to `/gate?gate_error=1`. */
  errorPath?: string;
  /** Override the tracker origin. Defaults to `trackerOrigin()`. */
  origin?: () => string;
  /** Override the configured slug. Defaults to `gateSlug()`. */
  slug?: () => string | undefined;
  /** Gate cookie lifetime. Defaults to 180 days. */
  cookieMaxAgeSeconds?: number;
}

function serializeGateCookie(value: string, maxAge: number): string {
  // SameSite=Lax (NOT None): Lax IS sent on top-level navigations, including a
  // tap from another app; None is treated as cross-site by iOS ITP.
  return `${GATE_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Build `{ GET, POST }` for the gate auth route.
 *
 * POST: validates email/password against the tracker's `/auth` (a server-side
 * fetch, invisible to the browser), then stores the tracker's `dt_session` JWT
 * as the value of the first-party `demo_gate` cookie on a relative 303 redirect
 * home. The proxy later forwards that JWT so `t.js` authenticates.
 *
 * GET: same-origin auth check for the /gate self-heal — returns `{ authed }`.
 */
export function createGateRoute(opts: GateRouteOptions): {
  GET: (req: Request) => Promise<Response>;
  POST: (req: Request) => Promise<Response>;
} {
  const errorPath = opts.errorPath ?? '/gate?gate_error=1';
  const getOrigin = opts.origin ?? trackerOrigin;
  const getSlug = opts.slug ?? gateSlug;
  const maxAge = opts.cookieMaxAgeSeconds ?? 60 * 60 * 24 * 180;

  function redirectTo(path: string, token?: string): Response {
    const headers = new Headers({ Location: path });
    if (token) headers.append('set-cookie', serializeGateCookie(token, maxAge));
    return new Response(null, { status: 303, headers });
  }

  // Same as redirectTo, but with a Location that CANNOT inherit the request's
  // query string.
  //
  // Netlify's Next runtime resolves a relative `Location` against the incoming
  // request URL and carries its search params over. Harmless for the POST path
  // (that request has no query), but on `GET /api/gate?t=<grant>` returning
  // `/en-us` actually redirects to `/en-us?t=<grant>` — and then the layout's
  // own `redirect('/gate')` inherits it again. Observed on logitech.ct-builders.ai
  // 2026-08-17: the grant ended up in the address bar, in browser history, in the
  // Referer sent to every third-party script on the page, and persisted into the
  // tracker's own `events.path` column.
  //
  // An absolute URL leaves nothing to resolve. Host comes from the forwarded
  // headers Netlify sets, falling back to the request's own URL for local dev.
  //
  // Resolving `path` against a base that carries NO query is what drops the
  // grant — so don't "tidy up" by clearing `target.search` afterwards: that also
  // ate the `?gate_error=1` on the error path and silently lost the gate's error
  // message. `path`'s own query is meant to survive; the request's must not.
  function redirectToAbsolute(req: Request, path: string, token?: string): Response {
    const self = new URL(req.url);
    const host = req.headers.get('x-forwarded-host') || self.host;
    const proto = req.headers.get('x-forwarded-proto') || self.protocol.replace(':', '');
    return redirectTo(new URL(path, `${proto}://${host}`).toString(), token);
  }

  async function POST(req: Request): Promise<Response> {
    const site = getSlug();
    // Gate not configured (no slug) — nothing to validate against; let them in.
    if (!site) return redirectTo(opts.homePath);

    const form = await req.formData().catch(() => null);
    const email = String(form?.get('email') ?? '').trim();
    const password = String(form?.get('password') ?? '');

    try {
      const r = await fetch(`${getOrigin()}/auth`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site, email, password }),
      });
      if (!r.ok) return redirectTo(errorPath);
      // Store the tracker's dt_session JWT as the cookie VALUE: the gate checks
      // only presence, but the proxy forwards this value to the tracker so
      // t.js's probe authenticates. Fall back to '1' only if the tracker set no
      // cookie (an abnormal path).
      const token = (r.headers.get('set-cookie') ?? '').match(/dt_session=([^;]+)/)?.[1] ?? '1';
      return redirectTo(opts.homePath, token);
    } catch {
      return redirectTo(errorPath);
    }
  }

  // Redeem a demo-tracker ADMIN GRANT — the "click the site link in demo-tracker
  // and land on the demo" path.
  //
  // A CT admin browsing the tracker is already IAP-authenticated and can read
  // this site's password in the column next to the link, so re-prompting is
  // friction, not security. The tracker mints a 5-minute grant JWT and sends the
  // browser to `/api/gate?t=<grant>`.
  //
  // We can't verify the grant here (the tracker owns the signing secret), so we
  // trade it server-side at the tracker's `/auth/grant`, which validates the
  // signature, creates the visitor + session rows, and hands back a `dt_session`
  // — the same token POST above scrapes, so the proxy keeps authenticating
  // `t.js` unchanged.
  //
  // The `/session` re-check is NOT redundant. `/auth/grant` validates a grant
  // against its OWN claims, not against the demo presenting it, so a grant minted
  // for a DIFFERENT demo would redeem successfully and hand back a
  // valid-but-foreign session — opening this storefront and then 401-ing every
  // `t.js` `/event` with "site mismatch". Confirming the session belongs to OUR
  // slug is what keeps a grant single-site.
  async function redeemGrant(req: Request, token: string): Promise<Response> {
    const site = getSlug();
    // Gate not configured (no slug) — nothing gated, nothing to redeem.
    if (!site) return redirectToAbsolute(req, opts.homePath);

    try {
      const r = await fetch(`${getOrigin()}/auth/grant?t=${encodeURIComponent(token)}&r=%2F`, {
        redirect: 'manual',
        cache: 'no-store',
      });
      const session = (r.headers.get('set-cookie') ?? '').match(/dt_session=([^;]+)/)?.[1];
      // Shape-check for the same reason the proxy does: it forwards only a
      // JWT-shaped value, so anything else would set a cookie that opens the gate
      // but leaves t.js unauthenticated.
      if (!session || !JWT_RE.test(session)) return redirectToAbsolute(req, errorPath);

      const check = await fetch(`${getOrigin()}/session?site=${encodeURIComponent(site)}`, {
        headers: { cookie: `${TRACKER_COOKIE}=${session}` },
        cache: 'no-store',
      });
      if (!check.ok) return redirectToAbsolute(req, errorPath);

      return redirectToAbsolute(req, opts.homePath, session);
    } catch {
      return redirectToAbsolute(req, errorPath);
    }
  }

  // Two jobs, split on the presence of `?t=`:
  //
  //   /api/gate?t=<grant>  redeem an admin grant (above) and enter the storefront.
  //   /api/gate            the /gate self-heal check.
  //
  // `grant: true` is a CAPABILITY MARKER, not state: the tracker probes this
  // endpoint to decide whether this demo understands `?t=` before it sends an
  // admin here. A demo on an older demotools answers `{ authed }` only, and the
  // tracker falls back to a plain link rather than redirecting an admin to a URL
  // that would render raw JSON at them. Don't drop the flag.
  async function GET(req: Request): Promise<Response> {
    const token = new URL(req.url).searchParams.get('t');
    if (token) return redeemGrant(req, token);

    const authed = !!parseCookies(req.headers.get('cookie'))[GATE_COOKIE];
    return new Response(JSON.stringify({ authed, grant: true }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  return { GET, POST };
}
