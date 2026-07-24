// commercetools product image rendition transforms.
//
// commercetools generates fixed-size renditions ONLY for images uploaded to its
// built-in media CDN (`images.cdn.<region>.<gcp|aws>.commercetools.com`) — you
// get them by inserting a size suffix before the file extension. For any OTHER
// image URL (a customer's own CDN, an imported third-party URL, the CT
// sample-data bucket, or a local asset) the suffix does NOT exist and 404s.
//
// So the safe, correct default is: auto-detect whether the URL is on the CT
// media CDN and only then apply the suffix; otherwise return the URL unchanged.
// This is a no-op for catalogs whose images aren't CT-hosted, and transparently
// serves right-sized renditions for catalogs whose images are.
//
// Isomorphic (pure string functions) — safe to import from client or server.

export type RenditionSize = 'thumb' | 'small' | 'medium' | 'large' | 'zoom';

/**
 * True when `url` points at the commercetools built-in image CDN, which is the
 * only host that serves the `-thumb`/`-small`/`-medium`/`-large`/`-zoom`
 * renditions. Matches `images.cdn.<region>.<gcp|aws>.commercetools.com`.
 * Relative/local URLs (e.g. `/products/foo.jpg`) are never CT-hosted.
 */
export function isCommercetoolsHostedImage(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return /^images\.cdn\.[a-z0-9-]+\.(gcp|aws)\.commercetools\.com$/.test(host);
}

/**
 * Append a CT rendition size suffix before the file extension — but ONLY when
 * the URL is on a host that actually serves renditions. By default that's the
 * CT media CDN (auto-detected); pass `allowedHosts` to scope to a specific CDN
 * instead (each entry is matched as a hostname substring). Returns the URL
 * unchanged when the host doesn't qualify, so it never produces a 404.
 */
export function appendRenditionSuffix(
  url: string,
  size: RenditionSize,
  allowedHosts?: string[],
): string {
  if (!url) return url;
  const qualifies = allowedHosts
    ? allowedHosts.some((h) => {
        try {
          return new URL(url).hostname.toLowerCase().includes(h.toLowerCase());
        } catch {
          return false;
        }
      })
    : isCommercetoolsHostedImage(url);
  if (!qualifies) return url;
  // Insert `-<size>` before the final extension, preserving any ?query/#fragment.
  return url.replace(/(\.[^./?#]+)($|[?#])/, `-${size}$1$2`);
}
