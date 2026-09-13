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
 *
 * The product DATA behind a search comes from GraphQL — see
 * ./product-search-gql.ts, which this module composes variables for. Only the
 * query expression lives here.
 */

import {
  PRODUCT_SEARCH_DOCUMENT,
  buildSearchVariables,
  type ProductSearchGraphQLVariables,
} from './product-search-gql.js';

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

/**
 * Store scoping for B2B / B2B2C catalogs.
 *
 * A dealer storefront must only ever show the products that dealer actually
 * sells. Getting this wrong is not a cosmetic bug — the assistant offers stock
 * the dealer does not carry, at prices that are not theirs.
 *
 * Two mechanisms, and both are applied because they fail differently:
 *
 *   - `storeProjection` gives per-store product *tailoring* (names, images,
 *     descriptions) and an *implicit* Product Selection restriction.
 *   - the explicit `productSelections` filters below are belt-and-suspenders.
 *     A store whose selection is attached but whose projection is missing or
 *     misconfigured would silently fall back to the whole catalog, and "silently
 *     shows everything" is the worst possible failure here.
 *
 * `variants.productSelections` is filtered alongside `productSelections`
 * because a selection can be variant-scoped.
 */
export interface StoreScope {
  /** Store key — sets `storeProjection` (tailoring + implicit selection). */
  storeKey?: string | null;
  /** Distribution channel — sets `priceChannel` for store-specific pricing. */
  distributionChannelId?: string | null;
  /** Product Selection id — restricts the catalog to the dealer's products. */
  productSelectionId?: string | null;
}

/**
 * Options for one catalog search: the relevance knobs plus the store scope.
 *
 * Named for a REST request body that no longer exists — `buildProductSearchGraphQL`
 * is the only consumer, and it composes GraphQL variables. The name is kept
 * because renaming an exported type breaks consumers for no behavioural gain;
 * read "Body" as "request".
 */
export interface ProductSearchBodyOptions extends RelevanceQueryOptions, StoreScope {
  currency: string;
  country: string;
  limit?: number;
  offset?: number;
  /** Passed through to `sort`. Defaults to relevance (`score` desc). */
  sort?: Array<Record<string, unknown>>;
}

/**
 * Price selection and store projection as `GET /product-projections` query
 * arguments — currency, country, channel, store, plus the discount expand.
 *
 * This is what `get_product_details` reads a single product with, and those are
 * supported query parameters on that endpoint. It is NOT the
 * `productProjectionParameters` block on `POST /products/search`, which is
 * deprecated: the search path composes GraphQL variables instead, via
 * `buildProductSearchGraphQL`.
 */
export function buildProjectionParameters(
  currency: string,
  country: string,
  scope?: StoreScope,
): Record<string, unknown> {
  return {
    priceCurrency: currency,
    priceCountry: country,
    expand: ['masterVariant.price.discounted.discount'],
    ...(scope?.storeKey && {
      storeProjection: scope.storeKey,
      ...(scope.distributionChannelId && { priceChannel: scope.distributionChannelId }),
    }),
  };
}

/**
 * Wrap a query expression in the store's Product Selection filters.
 *
 * Returns the expression unchanged when there is no selection, so a plain B2C
 * catalog pays nothing for this.
 */
export function applyStoreScope(
  query: ProductSearchQuery,
  scope?: StoreScope,
): ProductSearchQuery {
  if (!scope?.productSelectionId) return query;
  return {
    and: [
      query,
      { exact: { field: 'productSelections', value: scope.productSelectionId } },
      { exact: { field: 'variants.productSelections', value: scope.productSelectionId } },
    ],
  };
}

/**
 * The GraphQL request for a shopper query — document plus variables, ready to
 * POST to `/graphql`.
 *
 * Same boosted expression and same store scoping as the REST body; the
 * difference is where the PRODUCT DATA comes from. `productProjectionParameters`
 * is deprecated, so the product is read off the `product` sub-field of
 * `productsSearch` instead, in the same round trip as the ids. See
 * ./product-search-gql.ts.
 *
 * The expression travels as a variable rather than inlined, which is what lets
 * `mustMatch: 'any'` and `order: 'desc'` transfer unchanged — GraphQL coerces a
 * JSON string into an enum for a variable, but demands a bare identifier when
 * it is written into the document.
 */
export function buildProductSearchGraphQL(
  term: string,
  opts: ProductSearchBodyOptions,
): { query: string; variables: ProductSearchGraphQLVariables } {
  const {
    currency,
    country,
    limit = 6,
    offset = 0,
    sort,
    storeKey,
    distributionChannelId,
    productSelectionId,
    ...queryOpts
  } = opts;
  const scope: StoreScope = { storeKey, distributionChannelId, productSelectionId };

  return {
    query: PRODUCT_SEARCH_DOCUMENT,
    variables: buildSearchVariables({
      query: applyStoreScope(buildRelevanceQuery(term, queryOpts), scope),
      ...(sort ? { sort } : {}),
      limit,
      offset,
      currency,
      country,
      scope,
    }),
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
