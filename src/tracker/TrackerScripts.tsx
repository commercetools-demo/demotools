import { TRACKER_BASE_PATH, trackerSite } from './config.js';
import type { TrackerContext } from './types.js';

export interface TrackerScriptsProps {
  /**
   * Pre-populated `window.dt.context`. MUST be set before `t.js` loads (the
   * script reads it synchronously to attach the first pageview to the right
   * store/customer). Set `customer` only when a real customer is signed in.
   */
  context?: TrackerContext;
  /**
   * `window.dt.gate`. Leave `false` (default) when the app runs its OWN branded
   * gate (via createGateRoute) so `t.js` never renders a second "Demo access"
   * overlay — it loads on every page purely for analytics and stays silent until
   * the proxy authenticates it. Set `true` only if you want the tracker's own gate.
   */
  gate?: boolean;
  /** Tracker slug. Defaults to `NEXT_PUBLIC_DEMO_TRACKER_SITE`. */
  site?: string;
  /** First-party proxy mount path. Defaults to `/api/tracker`. */
  basePath?: string;
}

/**
 * Renders the two tracker `<script>` tags in document `<head>`. This is a
 * Server Component — render it inside your root layout's `<head>`.
 *
 * Loading `t.js` FIRST-PARTY through the proxy (`<basePath>/t.js`) instead of
 * cross-origin from the tracker host is the key iOS Safari ITP fix: zero
 * cross-origin tracker requests means ITP never classifies the site as a bounce
 * tracker (and never rewrites the gate cookie to SameSite=Strict). `t.js`
 * derives its API base from `document.currentScript`, so every follow-up call
 * it makes stays first-party too.
 *
 * Renders nothing unless both `NEXT_PUBLIC_DEMO_TRACKER_URL` and a slug are set.
 */
export default function TrackerScripts({
  context = {},
  gate = false,
  site,
  basePath = TRACKER_BASE_PATH,
}: TrackerScriptsProps) {
  const slug = site ?? trackerSite();
  if (!process.env.NEXT_PUBLIC_DEMO_TRACKER_URL || !slug) return null;
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `window.dt={context:${JSON.stringify(context)},gate:${gate ? 'true' : 'false'}};`,
        }}
      />
      <script async src={`${basePath}/t.js?site=${slug}`} />
    </>
  );
}
