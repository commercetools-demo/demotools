// Page-editor preview carve-out for the demo gate.
//
// Framework-agnostic and dependency-free, in both directions:
//   * no `next` import — the consumer passes the request headers it already has
//     (`await headers()` in a Next Server Component, `req.headers` elsewhere);
//   * no `@commercetools-demo/page-builder` import — the consumer passes the two
//     values from `getPageBuilderConfig()` that matter here. A gated demo without
//     a page builder should not acquire the editor as a dependency to keep its
//     gate working.

/**
 * Request headers, however the host framework hands them over. `Headers` covers
 * Next's `ReadonlyHeaders` and any fetch-standard runtime; the function form
 * covers everything else (`(n) => req.headers[n]` on a Node/Express request).
 */
export type HeaderReader = Headers | ((name: string) => string | null | undefined);

/** Read one header, lower-cased, from either shape. */
function readHeader(headers: HeaderReader, name: string): string | null {
  const raw = typeof headers === 'function' ? headers(name) : headers.get(name);
  return raw ?? null;
}

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The query parameter the page builder puts its preview token in. Matches
 * `PB_PREVIEW_PARAM` from `@commercetools-demo/page-builder`; a consumer that
 * already depends on that package should pass it through as `previewParam` so a
 * rename there becomes a compile-time concern in ONE repo instead of a silently
 * dead carve-out in every gated demo.
 */
export const DEFAULT_PREVIEW_PARAM = 'pb_preview';

/** The page-builder values the carve-out needs — a subset of `getPageBuilderConfig()`. */
export interface EditorPreviewOptions {
  /** `PB_ALLOWED_ORIGINS`: origins allowed to embed and drive the editing bridge. */
  allowedOrigins: string[];
  /** `PB_PREVIEW_TOKEN`. With no token there is no preview to make an exception for. */
  previewToken: string | undefined;
  /** Defaults to `pb_preview`. Pass `PB_PREVIEW_PARAM` to pin it to the editor's own constant. */
  previewParam?: string;
}

/** Why an editor-preview request was let through, or that it wasn't. */
export type EditorPreviewVerdict = 'editor-frame' | 'editor-token' | 'blocked';

/**
 * Does this request come from the page builder's preview iframe, rather than from a visitor?
 *
 * **Why it can't just read `?pb_preview=<token>`.** The token is in the query string and the
 * gate runs in a layout, and Next never gives a layout `searchParams` — only pages get those.
 * The usual escape hatch is middleware, which sees the whole URL, but `@netlify/plugin-nextjs`
 * does not deploy Next 16's `proxy.ts` as a routed edge handler (the same reason the gate is a
 * Server Component and not an edge function — see `gate.ts`), so on a Netlify deploy there is
 * nowhere on the request path that sees the URL before the layout renders. Request headers are
 * what a layout does get, so the carve-out is built out of those.
 *
 * Two rules, because a framed preview makes two different kinds of request:
 *
 * 1. **The frame's own document.** `Sec-Fetch-Dest: iframe` says the browser is loading this
 *    into a nested browsing context, and cross-site `Referer` is trimmed to the framing
 *    document's origin — so the test is "framed by an origin already trusted to drive the
 *    editing bridge over postMessage". That is the same `PB_ALLOWED_ORIGINS` allowlist, so a
 *    gated storefront trusts exactly the editors it already trusts and no new configuration
 *    appears.
 *
 * 2. **Everything that document then fetches for itself** — the RSC payload for an in-frame
 *    navigation, a route clicked inside the canvas. Those are same-origin, so `Referer` is the
 *    *full* preview URL and the real token can be checked. That makes rule 2 the strong one:
 *    it verifies the secret, not the shape of the request.
 *
 * Deliberate looseness in rule 1: a framing document that sends no `Referer` at all (a
 * `no-referrer` policy) is still allowed through, and a browser that omits `Sec-Fetch-*`
 * entirely (WebKit) falls back to the allowlisted `Referer` alone. The gate here is email
 * capture for a demo, not access control on anything private — the cost of being strict is a
 * blank editing canvas during a live demo, and the cost of being loose is that someone who
 * already knows the URL can iframe it to skip the email form.
 *
 * Returns 'blocked' unless this deployment is actually driven by the page builder: with no
 * `PB_PREVIEW_TOKEN` or an empty allowlist there is no preview to make an exception for.
 */
export function editorPreviewVerdict(
  headers: HeaderReader,
  { allowedOrigins, previewToken, previewParam = DEFAULT_PREVIEW_PARAM }: EditorPreviewOptions,
): EditorPreviewVerdict {
  if (!previewToken || allowedOrigins.length === 0) return 'blocked';

  const referer = readHeader(headers, 'referer');
  const refOrigin = originOf(referer);
  const dest = readHeader(headers, 'sec-fetch-dest');

  // Rule 2 first: it proves possession of the token, so it is the one to trust.
  if (referer) {
    try {
      if (new URL(referer).searchParams.get(previewParam) === previewToken) return 'editor-token';
    } catch {
      /* unparseable Referer — fall through to rule 1 */
    }
  }

  const framed = dest === 'iframe' || (dest === null && !!refOrigin);
  if (framed && (!refOrigin || allowedOrigins.includes(refOrigin))) return 'editor-frame';

  return 'blocked';
}

/**
 * Where to redirect a blocked request, with a diagnostic hint attached when the request did
 * not look like a top-level navigation.
 *
 * From inside an iframe a bare `307 → /gate` is indistinguishable from a broken deploy: the
 * storefront simply doesn't appear, and the parent document can't read the response body,
 * status or cookies across origins. The `Location` header is the one part of it that IS
 * visible, so the reason rides along there — `/gate?pb=iframe` says "your frame hit the demo
 * gate", which is what turns a hunt through the editor's source into a one-line answer.
 *
 * `sec-fetch-dest: document` (an ordinary visitor) gets a clean `/gate` with no hint.
 */
export function gateRedirectPath(headers: HeaderReader, gatePath = '/gate'): string {
  const dest = readHeader(headers, 'sec-fetch-dest');
  if (!dest || dest === 'document') return gatePath;
  const sep = gatePath.includes('?') ? '&' : '?';
  return `${gatePath}${sep}pb=${encodeURIComponent(dest)}`;
}
