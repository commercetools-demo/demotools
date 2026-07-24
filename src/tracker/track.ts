// Tiny shim over the demo-tracker `window.dt` API. Safe to call when the
// tracker script is not loaded (env vars unset, gate not yet passed) — the
// tracker itself queues events until it's ready. Isomorphic: no-ops during SSR.

import type { Dt, TrackProps } from './types.js';
import { TRACKER_BASE_PATH, trackerSite } from './config.js';

export function track(event: string, props?: TrackProps): void {
  if (typeof window === 'undefined') return;
  try {
    const dt = (window as unknown as { dt?: Dt }).dt;
    dt?.track(event, props);
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
    const ctx = (window as unknown as { dt?: Dt }).dt?.context ?? {};
    const cust = ctx.customer ?? {};
    const payload = JSON.stringify({
      site,
      ...(ctx.store ? { store: String(ctx.store) } : {}),
      ...(ctx.channel ? { channel: String(ctx.channel) } : {}),
      ...(cust.email ? { customer_email: String(cust.email) } : {}),
      ...(cust.id ? { customer_id: String(cust.id) } : {}),
      type: event.toLowerCase(),
      path: location.pathname + location.search,
      ...(props ? { props } : {}),
    });
    nav.sendBeacon(`${basePath}/event`, new Blob([payload], { type: 'application/json' }));
  } catch {
    // never let analytics throw
  }
}
