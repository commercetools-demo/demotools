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
 * Renders nothing unless a slug is configured.
 */
export default function TrackerScripts({
  context = {},
  gate = false,
  site,
  basePath = TRACKER_BASE_PATH,
}: TrackerScriptsProps) {
  const slug = site ?? trackerSite();
  // Slug only. This used to ALSO require NEXT_PUBLIC_DEMO_TRACKER_URL, which is
  // documented as optional everywhere else (`trackerOrigin()` defaults it to
  // https://tracker.ctdemo.net) — and which this component doesn't even use: the
  // script is loaded from the first-party proxy path, and `t.js` derives its API
  // base from `document.currentScript`. So the tracker origin never appears in
  // the client at all.
  //
  // The cost of that stray condition was silent: the GATE keys off the slug
  // alone (`isGateEnabled()`), so a demo set up exactly as documented — slug
  // set, URL omitted — gated correctly and recorded ZERO analytics. It looked
  // like an unused demo rather than a broken one. Found on bridge-patient /
  // bridge-provider (2026-08-20): real customer visitors had authenticated
  // through the gate on 2026-07-30 (session rows exist, attributed to
  // @mckesson.com addresses) and not one event was ever recorded.
  if (!slug) return null;
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `window.dt={context:${JSON.stringify(context)},gate:${gate ? 'true' : 'false'}};`,
        }}
      />
      {/*
        `defer`, NOT `async`: React 19 HOISTS async scripts, which reorders this
        tag ABOVE the inline `window.dt` assignment in the emitted HTML — the
        exact opposite of the ordering this component's contract requires (t.js
        reads window.dt.context synchronously to attach the first pageview to the
        right store/customer). A deferred script is left in place and runs after
        parsing, so the inline config always wins. Verified by
        test/runtime/tracker-scripts.test.mjs, which asserts the order in the
        rendered markup.
      */}
      <script defer src={`${basePath}/t.js?site=${slug}`} />
    </>
  );
}
