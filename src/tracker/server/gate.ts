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
//
// A demo with a page builder passes its headers too, so the editor's preview
// iframe is let through without a gate cookie — see `gateVerdict` below.

import { gateSlug, isGateEnabled, trackerOrigin } from '../config.js';
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
 * Order is cheapest-first: env, then the cookie already on the request, then the header
 * inspection. Every branch is presence-only — no per-render call to the tracker. Synchronous:
 * the caller awaits its framework's own `cookies()`/`headers()` and passes the results in.
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
export function gateVerdict({ gateCookieValue, headers, preview }: GateVerdictInput): GateVerdict {
  if (!isGateEnabled()) return 'disabled';
  if (gateCookieValue) return 'authed';
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
