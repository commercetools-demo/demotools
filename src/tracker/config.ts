// Isomorphic configuration + constants for the demo-tracker integration.
// Safe to import from BOTH client and server code — it only reads env vars and
// returns plain values. Deliberately has NO 'use client' directive and NO
// `next` import, so it can be pulled into a client bundle, a Server Component,
// or a route handler alike.
//
// Note on env inlining: `NEXT_PUBLIC_*` reads are written as literal
// `process.env.NEXT_PUBLIC_...` expressions so Next.js's build-time define pass
// inlines them into the client bundle even though this code ships compiled in
// node_modules. Do NOT rewrite these to dynamic `process.env[name]` access.

/**
 * Cookie the APP sets to mark a passed gate. Deliberately NOT the tracker's own
 * `dt_session` — a cookie name unassociated with the tracker keeps iOS Safari
 * ITP from classifying the site as a bounce tracker and rewriting it to
 * SameSite=Strict (which would withhold it on cross-app top-level navigations).
 */
export const GATE_COOKIE = 'demo_gate';

/** The cookie the tracker itself reads to authenticate `/event` + `/session`. */
export const TRACKER_COOKIE = 'dt_session';

/** Default mount path of the first-party tracker proxy (see createTrackerProxyRoute). */
export const TRACKER_BASE_PATH = '/api/tracker';

/** The configured tracker slug (`NEXT_PUBLIC_DEMO_TRACKER_SITE`), or undefined. */
export function trackerSite(): string | undefined {
  return process.env.NEXT_PUBLIC_DEMO_TRACKER_SITE || undefined;
}

/** The gate keys off the same slug as the tracker. */
export const gateSlug = trackerSite;

/** Tracker origin used by the first-party proxy, server-side `/auth`, and `/site-info`. */
export function trackerOrigin(): string {
  return process.env.NEXT_PUBLIC_DEMO_TRACKER_URL || 'https://tracker.ctdemo.net';
}

/**
 * Whether the password gate is enforced on this deploy: production AND a slug
 * configured. Forks with no slug deploy fully ungated; the gate is inert in
 * local dev regardless of the slug.
 */
export function isGateEnabled(): boolean {
  return process.env.NODE_ENV === 'production' && !!trackerSite();
}
