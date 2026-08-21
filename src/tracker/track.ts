// Tiny shim over the demo-tracker `window.dt` API. Isomorphic: no-ops during SSR.
//
// `window.dt` goes through TWO stages, and the gap between them is where events
// used to disappear:
//
//   1. `<TrackerScripts>` writes an inline `window.dt = { context, gate }` — NO
//      `track` method. This is a plain inline script, so it runs during parse.
//   2. `t.js` (loaded `defer`) later replaces it with
//      `Object.assign({}, existing, { track })`, and only from then on does
//      `window.dt.track` exist and queue-until-authed work.
//
// React can hydrate and run effects BEFORE a deferred script executes — the
// bigger the streamed document, the wider that window. So a `<TrackEvent>` on a
// heavy listing page routinely fired in stage 1, where `dt.track` is undefined.
// The old shim did `dt?.track(event, props)` inside a bare try/catch: the
// optional chain guards `dt` being absent, not `track` being absent, so it threw
// a TypeError straight into the catch and the event was silently dropped. Only
// client-side navigations (long after t.js) reliably recorded. Symptom: a demo
// with hundreds of pageviews and a handful of `view_category` / `view_product`
// rows, which reads as "nobody used the demo" rather than "tracking is broken".
//
// Fix: when `dt.track` is not available yet, POST the event ourselves, straight
// to the first-party proxy that `t.js` would have used. Same origin, same
// payload shape, authenticated server-side by the `demo_gate` cookie — so it
// works from the first millisecond of the page, with no dependence on t.js
// having executed and no queue to flush.

import type { Dt, TrackProps } from './types.js';
import { TRACKER_BASE_PATH, trackerSite } from './config.js';

/** `window.dt`, whatever stage it is at. */
function dt(): Dt | undefined {
  return (window as unknown as { dt?: Dt }).dt;
}

/**
 * `window.dt.track` if t.js has installed it. Stage 1 `window.dt` has no
 * `track`, so this must be a real `typeof` check — optional chaining is not
 * enough (see the header).
 */
function dtTrack(): ((type: string, props?: TrackProps) => void) | undefined {
  const d = dt();
  return d && typeof d.track === 'function' ? d.track.bind(d) : undefined;
}

/**
 * The event payload `t.js` builds: the slug plus whatever store / channel /
 * customer context the host page put on `window.dt`.
 */
function eventPayload(site: string, event: string, props?: TrackProps): string {
  const ctx = dt()?.context ?? {};
  const cust = ctx.customer ?? {};
  return JSON.stringify({
    site,
    ...(ctx.store ? { store: String(ctx.store) } : {}),
    ...(ctx.channel ? { channel: String(ctx.channel) } : {}),
    ...(cust.email ? { customer_email: String(cust.email) } : {}),
    ...(cust.id ? { customer_id: String(cust.id) } : {}),
    type: event.toLowerCase(),
    path: location.pathname + location.search,
    ...(props ? { props } : {}),
  });
}

/**
 * Record an event without t.js: POST it to the first-party tracker proxy the
 * same way t.js would. `keepalive` so it survives a navigation started right
 * after the call.
 *
 * Returns false when there is nothing to post to (no slug configured — tracker
 * off for this deploy), so the caller can stay silent exactly as before.
 */
function postDirect(event: string, props?: TrackProps): boolean {
  const site = trackerSite();
  if (!site || typeof fetch !== 'function') return false;
  void fetch(`${TRACKER_BASE_PATH}/event`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: eventPayload(site, event, props),
    keepalive: true,
  }).catch(() => {
    // Pre-gate this is a 401 and the event is genuinely not recordable, which
    // is also what t.js does. Never let analytics throw.
  });
  return true;
}

/**
 * Fire a semantic event. Safe to call at any point in the page lifecycle,
 * including before `t.js` has executed and before the gate has been passed.
 */
export function track(event: string, props?: TrackProps): void {
  if (typeof window === 'undefined') return;
  try {
    const viaScript = dtTrack();
    if (viaScript) {
      viaScript(event, props);
      return;
    }
    // t.js has not installed `track` yet — post it ourselves rather than
    // dropping it on the floor.
    postDirect(event, props);
  } catch {
    // never let analytics throw
  }
}

/**
 * Fire an event that must survive an *imminent hard navigation* — e.g. the
 * one-click demo login, which sets a cookie and then does a full
 * `window.location` reload. The normal track() path hands off to the tracker
 * script's fetch, which can be dropped when the page starts unloading right
 * after; `navigator.sendBeacon` is the browser's guaranteed-on-unload channel
 * (the tracker's own `t.js` uses it for pageleave).
 *
 * Posts first-party through the tracker proxy (`<basePath>/event`) with the
 * same payload shape `t.js` builds (site + store/channel/customer context from
 * `window.dt`). Falls back to track() when the beacon API or slug is unavailable.
 */
export function trackBeacon(
  event: string,
  props?: TrackProps,
  opts?: { site?: string; basePath?: string },
): void {
  if (typeof window === 'undefined') return;
  try {
    const site = opts?.site ?? trackerSite();
    const basePath = opts?.basePath ?? TRACKER_BASE_PATH;
    const nav = navigator as Navigator & {
      sendBeacon?: (url: string, data?: BodyInit) => boolean;
    };
    if (!site || typeof nav.sendBeacon !== 'function') {
      track(event, props);
      return;
    }
    nav.sendBeacon(
      `${basePath}/event`,
      new Blob([eventPayload(site, event, props)], { type: 'application/json' }),
    );
  } catch {
    // never let analytics throw
  }
}
