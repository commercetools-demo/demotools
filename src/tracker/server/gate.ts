// Server-side gate helpers.
//
// Deliberately NO `next` import — mirroring the chat/server convention of not
// coupling to a Next version. The consumer keeps a ~6-line `lib/gate.ts` that
// reads the cookie via `next/headers` cookies() and binds the home path to its
// own i18n routing, then delegates the logic here:
//
//   // site/lib/gate.ts
//   import { cookies } from 'next/headers';
//   import { routing } from '@/i18n/routing';
//   import { GATE_COOKIE, isGateEnabled, isGateOpen } from '@ct-demos/demotools/tracker/server';
//   export { gateSlug, trackerOrigin, isGateEnabled, siteIsOpen, GATE_COOKIE } from '@ct-demos/demotools/tracker/server';
//   export const GATE_HOME_PATH = `/${routing.defaultLocale}`;
//   export async function isDemoGateOpen(): Promise<boolean> {
//     if (!isGateEnabled()) return true;
//     return isGateOpen((await cookies()).get(GATE_COOKIE)?.value);
//   }
//
// A demo with a page builder passes its headers too, so the editor's preview
// iframe is let through without a gate cookie — see `gateVerdict` below.

import { JWT_RE, TRACKER_COOKIE, gateSlug, isGateEnabled, trackerOrigin } from '../config.js';
import { editorPreviewVerdict, type EditorPreviewOptions, type HeaderReader } from './preview.js';

export {
  editorPreviewVerdict,
  gateRedirectPath,
  DEFAULT_PREVIEW_PARAM,
  type EditorPreviewOptions,
  type EditorPreviewVerdict,
  type HeaderReader,
} from './preview.js';

export {
  GATE_COOKIE,
  TRACKER_COOKIE,
  TRACKER_BASE_PATH,
  trackerSite,
  gateSlug,
  trackerOrigin,
  isGateEnabled,
} from '../config.js';

// How long a verdict from the tracker is trusted without asking again. The
// positive TTL is what keeps this off the hot path: a visitor reading a demo
// costs one `/session` call per lambda per ten minutes, not one per render.
const VERIFY_TTL_OK_MS = 10 * 60_000;
// Negatives expire fast so a visitor who authenticates in another tab isn't
// held out by a cached refusal, while a loop of forged cookies still can't
// hammer the tracker.
const VERIFY_TTL_BAD_MS = 30_000;
// Longest a positive may be served from cache while the tracker is unreachable.
// Longer than any demo call, so an outage mid-presentation is invisible; short
// enough that "tracker down" can never mean "gate open indefinitely".
const VERIFY_STALE_MAX_MS = 6 * 60 * 60_000;
const VERIFY_CACHE_MAX = 500;

interface VerifyEntry {
  ok: boolean;
  at: number;
}

const verifyCache = new Map<string, VerifyEntry>();

function rememberVerdict(key: string, ok: boolean): void {
  // Re-insert to move the key to the end, so the eviction below is LRU rather
  // than insertion-order.
  verifyCache.delete(key);
  verifyCache.set(key, { ok, at: Date.now() });
  while (verifyCache.size > VERIFY_CACHE_MAX) {
    const oldest = verifyCache.keys().next().value;
    if (oldest === undefined) break;
    verifyCache.delete(oldest);
  }
}

/** Drop every cached verdict. Exported for tests. */
export function resetGateVerifyCache(): void {
  verifyCache.clear();
}

/**
 * Whether `token` is a live tracker session for THIS site, asked of the
 * tracker's `/session` and cached per lambda.
 *
 * The site check is the load-bearing half: `/session` answers 401 when the
 * session's claims name a different slug, so a real token minted on demo A
 * cannot open demo B.
 *
 * Reachability is separated from the verdict. A 401 is the tracker telling us
 * no; a 5xx or a thrown fetch tells us nothing, so a visitor already verified
 * on this lambda keeps their answer for up to `VERIFY_STALE_MAX_MS` and
 * everyone else is refused. Refusing a stranger during an outage costs them
 * nothing they could have had anyway — `/auth` lives on the same tracker.
 */
async function sessionIsValid(token: string): Promise<boolean> {
  const site = gateSlug();
  if (!site) return false;

  const key = `${site}\u0000${token}`;
  const hit = verifyCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < (hit.ok ? VERIFY_TTL_OK_MS : VERIFY_TTL_BAD_MS)) return hit.ok;
  const staleOk = !!hit && hit.ok && now - hit.at < VERIFY_STALE_MAX_MS;

  try {
    const r = await fetch(`${trackerOrigin()}/session?site=${encodeURIComponent(site)}`, {
      headers: { cookie: `${TRACKER_COOKIE}=${token}` },
      cache: 'no-store',
    });
    if (r.status === 200) {
      rememberVerdict(key, true);
      return true;
    }
    if (r.status >= 500) return staleOk;
    rememberVerdict(key, false);
    return false;
  } catch {
    return staleOk;
  }
}

/**
 * Whether the request may see the site: the gate is disabled (local dev, or no
 * slug configured) OR the visitor carries a gate cookie the tracker signed for
 * this site. Pass the `demo_gate` cookie value (or undefined).
 *
 * The cookie's value IS the tracker's `dt_session` JWT — `createGateRoute` puts
 * it there — so the token can be checked rather than merely counted. Presence
 * alone is not evidence: `demo_gate` is set by a route, not by a signature, and
 * any value a browser can be told to send would satisfy a truthiness test.
 */
export async function isGateOpen(gateCookieValue: string | undefined): Promise<boolean> {
  if (!isGateEnabled()) return true;
  if (!gateCookieValue || !JWT_RE.test(gateCookieValue)) return false;
  return sessionIsValid(gateCookieValue);
}

/**
 * Why the request may (or may not) see the site.
 *
 * A reason rather than a boolean, so the caller can say *which* rule fired when it redirects —
 * `editor-frame` and `editor-token` in particular are the difference between "the preview works
 * because we recognised the editor" and "the preview works because the gate happens to be off
 * on this deploy", which otherwise look identical from the canvas.
 */
export type GateVerdict = 'disabled' | 'authed' | 'editor-frame' | 'editor-token' | 'blocked';

export interface GateVerdictInput {
  /** The `demo_gate` cookie value on this request, or undefined. */
  gateCookieValue: string | undefined;
  /** Request headers — only consulted when `preview` is supplied and the cookie is absent. */
  headers?: HeaderReader;
  /**
   * Page-builder preview carve-out. Omit on a demo with no page builder and the verdict is the
   * plain cookie check: no editor exception exists, so none is offered.
   */
  preview?: EditorPreviewOptions;
}

/**
 * The gate decision for this request, with the reason attached.
 *
 * Order is cheapest-first: env, then the cookie already on the request (verified against the
 * tracker, cached per lambda — see `isGateOpen`), then the header inspection. The caller awaits
 * its framework's own `cookies()`/`headers()` and passes the results in.
 *
 * An unverifiable cookie falls through to the preview check rather than short-circuiting, so a
 * page-builder canvas carrying a stale cookie is still recognised as the editor.
 *
 *     // site/lib/gate.ts
 *     export async function gateVerdict(): Promise<GateVerdict> {
 *       const { allowedOrigins, previewToken } = getPageBuilderConfig();
 *       return libGateVerdict({
 *         gateCookieValue: (await cookies()).get(GATE_COOKIE)?.value,
 *         headers: await headers(),
 *         preview: { allowedOrigins, previewToken, previewParam: PB_PREVIEW_PARAM },
 *       });
 *     }
 */
export async function gateVerdict({
  gateCookieValue,
  headers,
  preview,
}: GateVerdictInput): Promise<GateVerdict> {
  if (!isGateEnabled()) return 'disabled';
  if (await isGateOpen(gateCookieValue)) return 'authed';
  if (!preview || !headers) return 'blocked';
  return editorPreviewVerdict(headers, preview);
}

/**
 * Whether the configured site is "open" — email-only, no password. Read from
 * the tracker's `/site-info`. When open, the gate collects just a work email;
 * otherwise it also requires the site password. Falls back to closed (password
 * shown) on any error, so a tracker hiccup never accidentally drops the gate.
 */
export async function siteIsOpen(): Promise<boolean> {
  const site = gateSlug();
  if (!site) return false;
  try {
    const r = await fetch(`${trackerOrigin()}/site-info?site=${encodeURIComponent(site)}`, {
      cache: 'no-store',
    });
    if (!r.ok) return false;
    const j = (await r.json()) as { open?: boolean };
    return j.open === true;
  } catch {
    return false;
  }
}
