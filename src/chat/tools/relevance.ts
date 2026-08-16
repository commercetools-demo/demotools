/**
 * Product Search query construction for the built-in commerce tools.
 *
 * This is the piece that was lost when a demo moved its read-side tools to a
 * Managed MCP Server, and it is the reason this module exists. A bare
 * `fullText` query against a demo catalog is *not* an acceptable substitute:
 *
 *   - `fullText` on the default field returns 0 hits for "wool rug" against a
 *     catalog whose product names are "Kalso Wool Rug" etc., because the
 *     analyzer never sees `searchKeywords` or the slug.
 *   - Without `boost`, a description-level match outranks a name-level match,
 *     so "wool rugs" comes back as a nightstand, a bowl and a painting.
 *
 * `buildRelevanceQuery` is the boosted name/searchKeywords/slug/SKU expression
 * the hand-written search used. It is exported on its own — not just wired into
 * the built-in tools — because the MCP path needs exactly the same expression
 * to be competitive, and it should not be reinvented per demo.
 */

/**
 * A commercetools Product Search query expression.
 *
 * Typed structurally rather than as the SDK's `ProductSearchRequest['query']` so
 * this file stays free of SDK types: query construction is pure, worth unit
 * testing on its own, and identical across SDK majors (the starters are on 8.x,
 * latest is 9.x). The value is plain JSON on the wire either way.
 */
export type ProductSearchQuery = Record<string, unknown>;

export interface RelevanceQueryOptions {
  /** Language for the `fullText` / `wildcard` fields, e.g. "en-US". */
  locale: string;
  /** Boost applied to a product-name match. Default 3. */
  nameBoost?: number;
  /** Boost applied to a searchKeywords match. Default 2. */
  keywordsBoost?: number;
  /** Include a `*term*` wildcard match on the slug. Default true. */
  matchSlug?: boolean;
  /** Include an exact, case-insensitive match on `variants.sku`. Default true. */
  matchSku?: boolean;
}

/**
 * Build the boosted relevance expression for a free-text shopper query.
 *
 * Name is weighted above searchKeywords, both above the slug wildcard, and an
 * exact SKU match is always allowed so "do you have IH-9021" works. `mustMatch:
 * 'any'` keeps multi-word queries recall-friendly — "wool rug" should match a
 * wool rug, not require both tokens in one field.
 */
export function buildRelevanceQuery(
  term: string,
  opts: RelevanceQueryOptions,
): ProductSearchQuery {
  const {
    locale,
    nameBoost = 3.0,
    keywordsBoost = 2.0,
    matchSlug = true,
    matchSku = true,
  } = opts;

  const value = term.trim();
  const or: ProductSearchQuery[] = [
    {
      fullText: {
        field: 'name',
        language: locale,
        value,
        mustMatch: 'any',
        boost: nameBoost,
      },
    },
    {
      fullText: {
        field: 'searchKeywords',
        language: locale,
        value,
        mustMatch: 'any',
        boost: keywordsBoost,
      },
    },
  ];

  if (matchSlug) {
    or.push({
      wildcard: {
        field: 'slug',
        language: locale,
        value: `*${value}*`,
        caseInsensitive: true,
      },
    });
  }

  if (matchSku) {
    or.push({ exact: { field: 'variants.sku', value, caseInsensitive: true } });
  }

  return { or };
}

export interface ProductSearchBodyOptions extends RelevanceQueryOptions {
  currency: string;
  country: string;
  limit?: number;
  offset?: number;
  /** Passed through to `sort`. Defaults to relevance (`score` desc). */
  sort?: Array<Record<string, unknown>>;
}

/**
 * Full Product Search request body for a shopper query.
 *
 * `markMatchingVariants` is on so the mapper can prefer the variant that
 * actually matched over the master variant — searching a SKU should show that
 * SKU's image and price, not the master's.
 */
export function buildProductSearchBody(
  term: string,
  opts: ProductSearchBodyOptions,
): Record<string, unknown> {
  const { currency, country, limit = 6, offset = 0, sort, ...queryOpts } = opts;

  return {
    limit,
    offset,
    markMatchingVariants: true,
    productProjectionParameters: {
      priceCurrency: currency,
      priceCountry: country,
      expand: ['masterVariant.price.discounted.discount'],
    },
    sort: sort ?? [{ field: 'score', order: 'desc' }],
    query: buildRelevanceQuery(term, queryOpts),
  };
}

/**
 * Pull a usable search term out of whatever the model actually sent.
 *
 * Models reliably emit the *Product Search wire shape* instead of a plain
 * string — `{"fullText":{"value":"wool rug"},"limit":6}`, or the query
 * expression hoisted to the top level instead of nested under `query`. Left
 * alone, the server sees no query at all and returns a match-all page, which
 * reads as bad relevance but is really a dropped filter.
 *
 * Accepts a string, `{query}`, `{searchTerm}`, `{text}`, `{fullText:{value}}`,
 * or a nested `{query:{...}}`, and returns the first non-empty term found.
 */
export function normalizeSearchTerm(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (!raw || typeof raw !== 'object') return '';

  const o = raw as Record<string, unknown>;

  for (const key of ['query', 'searchTerm', 'search', 'text', 'q', 'keyword', 'keywords']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }

  // `{ fullText: { value } }` — or the whole thing wrapped one level deeper.
  const fullText = o.fullText as { value?: unknown } | undefined;
  if (fullText && typeof fullText.value === 'string' && fullText.value.trim()) {
    return fullText.value.trim();
  }

  for (const key of ['query', 'body']) {
    const nested = o[key];
    if (nested && typeof nested === 'object') {
      const found = normalizeSearchTerm(nested);
      if (found) return found;
    }
  }

  // `{ or: [ { fullText: {...} }, … ] }`
  const or = o.or;
  if (Array.isArray(or)) {
    for (const clause of or) {
      const found = normalizeSearchTerm(clause);
      if (found) return found;
    }
  }

  return '';
}

/** Clamp a model-supplied result count into something sane for a chat panel. */
export function normalizeLimit(raw: unknown, fallback = 6, max = 24): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}
