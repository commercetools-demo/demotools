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

  async function GET(req: Request): Promise<Response> {
    const authed = !!parseCookies(req.headers.get('cookie'))[GATE_COOKIE];
    return new Response(JSON.stringify({ authed }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  return { GET, POST };
}
