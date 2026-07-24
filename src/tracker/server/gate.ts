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
//   import { GATE_COOKIE, isGateEnabled, isGateOpen } from '@cboyke/demotools/tracker/server';
//   export { gateSlug, trackerOrigin, isGateEnabled, siteIsOpen, GATE_COOKIE } from '@cboyke/demotools/tracker/server';
//   export const GATE_HOME_PATH = `/${routing.defaultLocale}`;
//   export async function isDemoGateOpen(): Promise<boolean> {
//     if (!isGateEnabled()) return true;
//     return isGateOpen((await cookies()).get(GATE_COOKIE)?.value);
//   }

import { gateSlug, isGateEnabled, trackerOrigin } from '../config.js';

export {
  GATE_COOKIE,
  TRACKER_COOKIE,
  TRACKER_BASE_PATH,
  trackerSite,
  gateSlug,
  trackerOrigin,
  isGateEnabled,
} from '../config.js';

/**
 * Whether the request may see the site: the gate is disabled (local dev, or no
 * slug configured) OR the visitor carries the gate cookie. Presence-only — no
 * per-render external fetch. Pass the `demo_gate` cookie value (or undefined).
 */
export function isGateOpen(gateCookieValue: string | undefined): boolean {
  if (!isGateEnabled()) return true;
  return !!gateCookieValue;
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
