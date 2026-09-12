/**
 * Product Search over GraphQL — the data-integration half of the chat read.
 *
 * `POST /products/search` returns ids. The product data behind those ids comes
 * from the `product` sub-field of the GraphQL `productsSearch` query, which
 * carries price selection and store projection in the same round trip. The
 * `productProjectionParameters` block that used to do this is deprecated
 * (announced 11 December 2025) and will be removed.
 *
 * Everything here is pure — the document, the variables and the response shim.
 * No client, so `test/runtime` can import it. The I/O lives in `builtin.ts`.
 *
 * `relevance.ts` still owns the *query expression*: the boosted
 * name/searchKeywords/slug/SKU OR-group and the store's Product Selection
 * filters. That expression travels here unchanged, as a GraphQL **variable** —
 * which is the point. For a variable, GraphQL coerces a JSON string into an
 * enum by name, so `mustMatch: 'any'`, `fieldType: 'text'` and `order: 'desc'`
 * transfer untouched; inlined into the document, every one of them would need
 * quoting by hand and `order: "desc"` is a hard error.
 *
 * Three things here differ from the storefront implementations of the same move
 * (b2c-starter, b2c-omnichannel-starter), because this package's mapper is
 * different:
 *
 *   1. **No `localesProjection`.** `localized()` deliberately falls back
 *      exact locale → same language → any `en` → *first value*, because demo
 *      catalogs are routinely seeded in one language while the storefront runs
 *      another. Trimming the returned locales would strip the value that last
 *      fallback exists to find, and every product in the chat panel would
 *      render a blank name.
 *   2. **`isMatchingVariant` is set on the variants themselves**, because
 *      `representativeVariant` reads that flag off the projection rather than
 *      taking a set of ids.
 *   3. **`fractionDigits` and `availableQuantity` are selected**, because
 *      `toMoney` and `inStock` read them.
 */

import type { ProductProjection } from '@commercetools/platform-sdk';

import type { ProductSearchQuery, StoreScope } from './relevance.js';

// ── The query document ────────────────────────────────────────────────────────

/**
 * The variant selection.
 *
 * `price` is the SELECTED price for the market and channel — the GraphQL
 * equivalent of the `priceCurrency`/`priceCountry`/`priceChannel` projection
 * parameters this replaced. `prices` comes along because `variantPrice` falls
 * back to `prices[0]` when no price was selected, which is what keeps a
 * catalog with no country prices from rendering every tile priceless.
 *
 * `fractionDigits` matters: `toMoney` carries it through to the display
 * contract, and a missing one silently formats minor units as if the currency
 * had two decimal places.
 */
const VARIANT_SELECTION = `
  id
  sku
  images { url }
  availability { noChannel { isOnStock availableQuantity } }
  price(currency: $currency, country: $country, channelId: $channelId) {
    value { centAmount currencyCode fractionDigits }
    discounted { value { centAmount currencyCode fractionDigits } }
  }
  prices {
    value { centAmount currencyCode fractionDigits }
    discounted { value { centAmount currencyCode fractionDigits } }
  }
`;

/**
 * `matched` is how `isMatchingVariant` survives the move.
 *
 * The GraphQL `ProductSearchResult` type exposes only `id` and `product` —
 * there is no `matchingVariants` object to read, and the migration guide offers
 * no replacement. But `allVariants(onlyMatching: true)` answers with the
 * platform's own matched set, computed on the index by the same
 * `markMatchingVariants` flag. So the marking stays the index's, rather than a
 * predicate re-evaluated here against the returned variants — which would have
 * to track every filter shape a caller can emit to stay correct.
 *
 * `allVariants` rather than `variants`, because `variants` excludes the master
 * variant and a SKU search can match the master.
 */
export const PRODUCT_SEARCH_DOCUMENT = `
  query DemotoolsChatProductSearch(
    $query: SearchQueryInput
    $sort: [SearchSortingInput!]
    $limit: Int
    $offset: Int
    $currency: Currency!
    $country: Country
    $channelId: String
    $storeProjection: String
  ) {
    productsSearch(
      query: $query
      sort: $sort
      limit: $limit
      offset: $offset
      markMatchingVariants: true
    ) {
      total
      results {
        id
        product(storeProjection: $storeProjection) {
          id
          masterData {
            current {
              nameAllLocales { locale value }
              slugAllLocales { locale value }
              masterVariant { ${VARIANT_SELECTION} }
              allVariants { ${VARIANT_SELECTION} }
              matched: allVariants(onlyMatching: true) { id }
            }
          }
        }
      }
    }
  }
`;

export interface ProductSearchGraphQLVariables {
  query?: unknown;
  sort?: unknown;
  limit: number;
  offset: number;
  currency: string;
  country?: string;
  channelId?: string;
  storeProjection?: string;
}

/**
 * Build the GraphQL variables for one chat product search.
 *
 * Takes the already-composed query expression rather than a search term, so the
 * boosting and store-scoping rules stay in `relevance.ts` and this file stays
 * pure translation. `buildProductSearchGraphQL` there is the convenience
 * wrapper that goes from a term to `{ query, variables }`.
 *
 * A `range` expression would need type-keying (`{ long: … }`) for GraphQL, and
 * a single-member `and`/`or` would need unwrapping. Neither is reachable here:
 * `buildRelevanceQuery` emits only `fullText`/`wildcard`/`exact` clauses, and
 * `applyStoreScope` only ever builds a three-member `and`. A caller that starts
 * emitting ranges needs the translation the storefront implementations carry.
 */
export function buildSearchVariables(params: {
  query: ProductSearchQuery;
  sort?: Array<Record<string, unknown>>;
  limit: number;
  offset: number;
  currency: string;
  country?: string;
  scope?: StoreScope;
}): ProductSearchGraphQLVariables {
  const { query, sort, limit, offset, currency, country, scope } = params;
  return {
    query,
    sort: sort ?? [{ field: 'score', order: 'desc' }],
    limit,
    offset,
    currency,
    ...(country ? { country } : {}),
    ...(scope?.distributionChannelId ? { channelId: scope.distributionChannelId } : {}),
    ...(scope?.storeKey ? { storeProjection: scope.storeKey } : {}),
  };
}

// ── Response shim ─────────────────────────────────────────────────────────────

interface LocalizedEntry {
  locale: string;
  value: string;
}

interface GraphQLMoney {
  centAmount?: number;
  currencyCode?: string;
  fractionDigits?: number;
}

interface GraphQLPrice {
  value?: GraphQLMoney | null;
  discounted?: { value?: GraphQLMoney | null } | null;
}

interface GraphQLVariant {
  id: number;
  sku?: string | null;
  images?: Array<{ url: string }> | null;
  availability?: {
    noChannel?: { isOnStock?: boolean | null; availableQuantity?: number | null } | null;
  } | null;
  price?: GraphQLPrice | null;
  prices?: GraphQLPrice[] | null;
}

interface GraphQLProductData {
  nameAllLocales?: LocalizedEntry[] | null;
  slugAllLocales?: LocalizedEntry[] | null;
  masterVariant?: GraphQLVariant | null;
  allVariants?: GraphQLVariant[] | null;
  matched?: Array<{ id: number }> | null;
}

export interface GraphQLSearchResultEntry {
  id: string;
  product?: {
    id: string;
    masterData?: { current?: GraphQLProductData | null } | null;
  } | null;
}

export interface GraphQLProductsSearchResponse {
  total?: number | null;
  results?: GraphQLSearchResultEntry[] | null;
}

/** `[{ locale, value }]` → `{ [locale]: value }`, the shape `localized` reads. */
export function localizedFromAllLocales(
  entries: LocalizedEntry[] | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { locale, value } of entries ?? []) out[locale] = value;
  return out;
}

function shimPrice(price: GraphQLPrice): Record<string, unknown> {
  const money = (m: GraphQLMoney | null | undefined) => ({
    centAmount: m?.centAmount ?? 0,
    currencyCode: m?.currencyCode ?? '',
    ...(typeof m?.fractionDigits === 'number' ? { fractionDigits: m.fractionDigits } : {}),
  });
  return {
    value: money(price.value),
    ...(price.discounted ? { discounted: { value: money(price.discounted.value) } } : {}),
  };
}

function shimVariant(variant: GraphQLVariant, isMatching: boolean): Record<string, unknown> {
  const noChannel = variant.availability?.noChannel;
  return {
    id: variant.id,
    ...(variant.sku ? { sku: variant.sku } : {}),
    images: (variant.images ?? []).map((i) => ({ url: i.url })),
    ...(variant.price ? { price: shimPrice(variant.price) } : {}),
    prices: (variant.prices ?? []).map(shimPrice),
    // REST flattens channel-less stock onto the variant; GraphQL keeps the
    // no-channel case in its own branch. An unwrapped `availability` would read
    // as "no inventory tracking", which `inStock` treats as in stock — so this
    // one fails towards optimism rather than towards an error.
    ...(noChannel
      ? {
          availability: {
            ...(typeof noChannel.isOnStock === 'boolean'
              ? { isOnStock: noChannel.isOnStock }
              : {}),
            ...(typeof noChannel.availableQuantity === 'number'
              ? { availableQuantity: noChannel.availableQuantity }
              : {}),
          },
        }
      : {}),
    // `representativeVariant` reads this flag off the variant rather than
    // taking a set of matched ids, so the marking has to be written on.
    isMatchingVariant: isMatching,
  };
}

/**
 * One GraphQL result → the `ProductProjection` shape `toProductSummary` reads.
 *
 * Going through the existing mapper rather than building a `ProductSummary`
 * directly is the point: the locale fallbacks, the discounted-price preference
 * and the representative-variant rule stay in one place, and this file only
 * restates the field names that actually differ.
 */
export function shimSearchResult(
  entry: GraphQLSearchResultEntry,
): ProductProjection | undefined {
  const current = entry.product?.masterData?.current;
  if (!entry.product || !current) return undefined;

  const allVariants = current.allVariants ?? [];
  // `allVariants` leads with the master, so it is the fallback when a caller's
  // selection left `masterVariant` out.
  const master = current.masterVariant ?? allVariants[0];
  if (!master) return undefined;

  // An empty or complete matched list means "no variant-level filter applied",
  // which REST signalled as `allMatched: true`. Nothing is marked in that case,
  // and the distinction matters more than it looks:
  // `representativeVariant` searches `product.variants` — which EXCLUDES the
  // master — before falling back to the master. So marking every variant on a
  // browse would make it return the SECOND variant of every product, and the
  // chat panel would show each product's second colourway instead of its
  // canonical one. Marking none lets it fall through to the master, which is
  // what a browse should show.
  const matchedIds = new Set((current.matched ?? []).map((v) => v.id));
  const noVariantFilter = matchedIds.size === 0 || matchedIds.size >= allVariants.length;
  const isMatching = (id: number) => !noVariantFilter && matchedIds.has(id);

  // `allVariants` includes the master; `ProductProjection.variants` excludes it.
  const rest = allVariants.filter((v) => v.id !== master.id);

  return {
    id: entry.product.id,
    name: localizedFromAllLocales(current.nameAllLocales),
    slug: localizedFromAllLocales(current.slugAllLocales),
    masterVariant: shimVariant(master, isMatching(master.id)),
    variants: rest.map((v) => shimVariant(v, isMatching(v.id))),
  } as unknown as ProductProjection;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export interface GraphQLErrorEntry {
  message?: string;
  extensions?: { code?: string };
}

/**
 * GraphQL answers HTTP 200 with an `errors` array for a query the index
 * refuses, so a failed search does not throw the way the REST call did. The
 * caller has to look.
 */
export function graphQLErrorsOf(body: unknown): GraphQLErrorEntry[] {
  const errors = (body as { errors?: unknown } | null | undefined)?.errors;
  return Array.isArray(errors) ? (errors as GraphQLErrorEntry[]) : [];
}

/** The joined error text, for matching against and for the thrown message. */
export function graphQLErrorMessage(errors: GraphQLErrorEntry[]): string {
  return errors
    .map((e) => e?.message ?? '')
    .filter(Boolean)
    .join('; ');
}

/**
 * Product Search switched off on the project, reported through the GraphQL
 * envelope.
 *
 * `isProductSearchDisabledError` classifies a THROWN error, which is still how
 * a 4xx arrives. A refused GraphQL query never throws — it is HTTP 200 with an
 * `errors` array — so this asks the same question of that shape, anchored on
 * the same message text.
 */
export function isSearchDisabledGraphQLError(errors: GraphQLErrorEntry[]): boolean {
  return errors.some((e) => {
    const msg = e?.message ?? '';
    return (
      msg.includes('Product Search API is not enabled') ||
      (e?.extensions?.code === 'ObjectNotFound' && msg.includes('Product Search'))
    );
  });
}
