// ── commercetools Product Search "not enabled" detection ─────────────────────
// Product Search is off by default on new CT projects (and auto-deactivates
// after ~30 days idle). When disabled, CT returns HTTP 400 whose message
// contains "Product Search API is not enabled". Detect it, cache it (throttled
// probe), and let the layout render <ProductSearchDisabledBanner> instead of the
// app crashing on an empty catalog.
// https://docs.commercetools.com/api/projects/product-search#activate-the-product-search-api

/**
 * True if `err` is the commercetools "Product Search API is not enabled" error.
 * Pure — anchors on the message text (the `ObjectNotFound` code is overloaded
 * for many resource-not-found cases).
 */
export function isProductSearchDisabledError(err: unknown): boolean {
  const e = err as {
    statusCode?: number;
    body?: { message?: string; errors?: Array<{ code?: string; message?: string }> };
    message?: string;
  };
  const msg = e?.body?.message ?? e?.message ?? '';
  const code = e?.body?.errors?.[0]?.code;
  return (
    msg.includes('Product Search API is not enabled') ||
    (code === 'ObjectNotFound' && msg.includes('Product Search'))
  );
}

export interface ProductSearchStatus {
  /** True if the given error is the Product-Search-disabled error. */
  isProductSearchDisabledError: (err: unknown) => boolean;
  /** Fast, no-network: whether Product Search is currently believed disabled. */
  isProductSearchDisabled: () => boolean;
  /**
   * Probe Product Search so the layout can show the setup banner on every page.
   * Throttled to once per `ttlMs` (default 30s) per worker. Returns true when
   * enabled. Runs the caller-supplied `probe` (which should issue a cheap,
   * zero-result Product Search against the app's own configured client, so the
   * probe uses the exact same region/middleware/scopes as real calls).
   */
  checkProductSearchEnabled: () => Promise<boolean>;
}

/**
 * Build a throttled Product-Search status tracker bound to the app's own probe.
 * Each instance owns its own cached flag, so create ONE per app (in the
 * storefront's search module) and re-export its members.
 *
 *   // site/lib/ct/search.ts
 *   import { createProductSearchStatus } from '@cboyke/demotools/ct/server';
 *   const status = createProductSearchStatus(() =>
 *     apiRoot.products().search().post({ body: { limit: 0 } }).execute().then(() => {}));
 *   export const { isProductSearchDisabledError, isProductSearchDisabled,
 *     checkProductSearchEnabled } = status;
 */
export function createProductSearchStatus(
  probe: () => Promise<void>,
  opts?: { ttlMs?: number },
): ProductSearchStatus {
  const ttl = opts?.ttlMs ?? 30_000;
  let disabled = false;
  let lastProbeAt = 0;

  async function checkProductSearchEnabled(): Promise<boolean> {
    const now = Date.now();
    if (now - lastProbeAt < ttl) return !disabled;
    lastProbeAt = now;
    try {
      await probe();
      disabled = false;
      return true;
    } catch (err) {
      if (isProductSearchDisabledError(err)) {
        disabled = true;
        return false;
      }
      // Any other failure — leave the flag as-is; the real call site surfaces it.
      return !disabled;
    }
  }

  return {
    isProductSearchDisabledError,
    isProductSearchDisabled: () => disabled,
    checkProductSearchEnabled,
  };
}
