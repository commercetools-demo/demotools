// Runtime tests for the Product Search GraphQL document, variables and shim.
//
// The catalog read moved off `productProjectionParameters`, which is deprecated,
// onto the `product` sub-field of the GraphQL `productsSearch` query. The index
// still does the searching: the boosted expression from relevance.ts and the
// store's Product Selection filters travel as GraphQL variables, unchanged.
//
// What these tests guard is the seam, and the failures worth guarding are the
// quiet ones — a request that GraphQL refuses at least says so:
//
//   1. **Locale trimming.** `localized()` falls back exact → same language →
//      any `en` → first value, because demo catalogs are routinely seeded in one
//      language while the storefront runs another. Adding `localesProjection`
//      would strip the value that last fallback exists to find, and every
//      product in the chat panel would render a blank name.
//   2. **`isMatchingVariant`.** `representativeVariant` reads that flag off the
//      variant, so the shim has to write it on — otherwise a SKU search answers
//      about the blue one with a picture of the grey one.
//   3. **Dropped fields.** A missing `fractionDigits` silently formats minor
//      units as if every currency had two decimal places; a missing
//      `availability` reads as "no inventory tracking", i.e. in stock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRODUCT_SEARCH_DOCUMENT,
  graphQLErrorMessage,
  graphQLErrorsOf,
  isSearchDisabledGraphQLError,
  localizedFromAllLocales,
  shimSearchResult,
} from '../../dist/chat/tools/product-search-gql.js';
import { buildProductSearchGraphQL } from '../../dist/chat/tools/relevance.js';
import { toProductSummary } from '../../dist/chat/tools/mappers.js';

// --- the document ----------------------------------------------------------

test('the document reads the product off the search result, not a projection block', () => {
  assert.match(PRODUCT_SEARCH_DOCUMENT, /productsSearch\(/);
  assert.match(PRODUCT_SEARCH_DOCUMENT, /product\(storeProjection: \$storeProjection\)/);
  assert.match(PRODUCT_SEARCH_DOCUMENT, /markMatchingVariants: true/);
  assert.ok(
    !PRODUCT_SEARCH_DOCUMENT.includes('productProjectionParameters'),
    'the deprecated block must not reappear',
  );
});

test('the document does NOT trim locales', () => {
  // `localized()` falls back all the way to "first value" for catalogs seeded in
  // a language the storefront does not run. `localesProjection` would remove
  // exactly that value, and every tile would render a blank name — with no error.
  assert.ok(
    !PRODUCT_SEARCH_DOCUMENT.includes('localesProjection'),
    'trimming locales would defeat the mapper fallback',
  );
  assert.match(PRODUCT_SEARCH_DOCUMENT, /nameAllLocales \{ locale value \}/);
});

test('the selection carries fractionDigits and availableQuantity', () => {
  // toMoney carries fractionDigits into the display contract; inStock falls
  // back to availableQuantity. Both are read, so both must be selected.
  assert.match(PRODUCT_SEARCH_DOCUMENT, /centAmount currencyCode fractionDigits/);
  assert.match(PRODUCT_SEARCH_DOCUMENT, /isOnStock availableQuantity/);
});

test('the matched set is read from allVariants, not variants', () => {
  // `variants` excludes the master, and a SKU search can match the master.
  assert.match(PRODUCT_SEARCH_DOCUMENT, /matched: allVariants\(onlyMatching: true\)/);
});

// --- variables -------------------------------------------------------------

test('buildProductSearchGraphQL threads relevance and scope into variables', () => {
  const { query, variables } = buildProductSearchGraphQL('rug', {
    locale: 'en-US',
    currency: 'EUR',
    country: 'DE',
    limit: 4,
    storeKey: 'dealer-berlin',
    distributionChannelId: 'dc-1',
    productSelectionId: 'ps-1',
  });

  assert.equal(query, PRODUCT_SEARCH_DOCUMENT);
  assert.equal(variables.limit, 4);
  assert.equal(variables.currency, 'EUR');
  assert.equal(variables.country, 'DE');
  assert.equal(variables.storeProjection, 'dealer-berlin');
  assert.equal(variables.channelId, 'dc-1');
  assert.deepEqual(variables.sort, [{ field: 'score', order: 'desc' }]);
  // The boosted expression survives, wrapped in the selection filters.
  assert.equal(
    variables.query.and.filter((c) => c.exact?.value === 'ps-1').length,
    2,
    'store scoping is still applied',
  );
  assert.ok(
    variables.query.and.find((c) => c.or)?.or[0].fullText.boost === 3,
    'and the relevance boost survives inside it',
  );
});

test('a plain B2C search carries no store or channel variable', () => {
  const { variables } = buildProductSearchGraphQL('rug', {
    locale: 'en-US',
    currency: 'USD',
    country: 'US',
  });
  assert.ok(!('storeProjection' in variables));
  assert.ok(!('channelId' in variables));
  assert.equal(variables.limit, 6, 'the default');
  assert.ok(variables.query.or, 'the bare boosted expression, unwrapped');
});

test('enum-valued options stay JSON strings, because they travel as variables', () => {
  // This is why the expression is a variable rather than inlined: GraphQL
  // coerces a JSON string into an enum by name for a variable, but demands a
  // bare identifier inside the document, where `"any"` is a hard error.
  const { variables } = buildProductSearchGraphQL('wool rug', {
    locale: 'en-US',
    currency: 'USD',
    country: 'US',
  });
  assert.equal(variables.query.or[0].fullText.mustMatch, 'any');
  assert.equal(variables.sort[0].order, 'desc');
});

// --- the shim --------------------------------------------------------------

test('localizedFromAllLocales rebuilds the record the mapper reads', () => {
  assert.deepEqual(
    localizedFromAllLocales([
      { locale: 'en-US', value: 'Wool Rug' },
      { locale: 'de-DE', value: 'Wollteppich' },
    ]),
    { 'en-US': 'Wool Rug', 'de-DE': 'Wollteppich' },
  );
  assert.deepEqual(localizedFromAllLocales(null), {});
});

const variant = (id, extra = {}) => ({
  id,
  sku: `SKU-${id}`,
  images: [{ url: `https://img/${id}.jpg` }],
  availability: { noChannel: { isOnStock: true, availableQuantity: 5 } },
  price: { value: { centAmount: 1000 * id, currencyCode: 'USD', fractionDigits: 2 } },
  prices: [{ value: { centAmount: 1000 * id, currencyCode: 'USD', fractionDigits: 2 } }],
  ...extra,
});

const entry = (current) => ({
  id: 'p1',
  product: {
    id: 'p1',
    masterData: {
      current: {
        nameAllLocales: [{ locale: 'en-US', value: 'Kalso Wool Rug' }],
        slugAllLocales: [{ locale: 'en-US', value: 'kalso-wool-rug' }],
        ...current,
      },
    },
  },
});

test('a matched variant is the one the summary represents', () => {
  // The whole reason markMatchingVariants is on: searching a SKU should show
  // that SKU's image and price, not the master's.
  const projection = shimSearchResult(
    entry({
      masterVariant: variant(1),
      allVariants: [variant(1), variant(2), variant(3)],
      matched: [{ id: 3 }],
    }),
  );
  assert.equal(projection.masterVariant.isMatchingVariant, false);
  assert.equal(projection.variants.find((v) => v.id === 3).isMatchingVariant, true);

  const summary = toProductSummary(projection, 'en-US');
  assert.equal(summary.variantId, 3, 'the matched variant represents the product');
  assert.equal(summary.sku, 'SKU-3');
  assert.equal(summary.imageUrl, 'https://img/3.jpg');
});

test('a matching master variant is marked, since allVariants includes it', () => {
  const projection = shimSearchResult(
    entry({ masterVariant: variant(1), allVariants: [variant(1), variant(2)], matched: [{ id: 1 }] }),
  );
  assert.equal(projection.masterVariant.isMatchingVariant, true);
  assert.equal(toProductSummary(projection, 'en-US').variantId, 1);
});

test('a browse with no variant filter falls back to the master', () => {
  // An empty or complete matched list means no variant-level filter was
  // applied, and representativeVariant should land on the master.
  for (const matched of [[], [{ id: 1 }, { id: 2 }]]) {
    const projection = shimSearchResult(
      entry({ masterVariant: variant(1), allVariants: [variant(1), variant(2)], matched }),
    );
    assert.equal(toProductSummary(projection, 'en-US').variantId, 1);
  }
});

test('the master is not repeated in variants', () => {
  const projection = shimSearchResult(
    entry({ masterVariant: variant(1), allVariants: [variant(1), variant(2)], matched: [] }),
  );
  assert.deepEqual(projection.variants.map((v) => v.id), [2]);
});

test('a missing masterVariant falls back to the first of allVariants', () => {
  const projection = shimSearchResult(entry({ allVariants: [variant(7), variant(8)], matched: [] }));
  assert.equal(projection.masterVariant.id, 7);
  assert.deepEqual(projection.variants.map((v) => v.id), [8]);
});

test('the fields toProductSummary reads all survive the shim', () => {
  const projection = shimSearchResult(
    entry({ masterVariant: variant(1), allVariants: [variant(1)], matched: [] }),
  );
  const summary = toProductSummary(projection, 'en-US');
  assert.equal(summary.id, 'p1');
  assert.equal(summary.name, 'Kalso Wool Rug');
  assert.equal(summary.slug, 'kalso-wool-rug');
  assert.equal(summary.sku, 'SKU-1');
  assert.equal(summary.imageUrl, 'https://img/1.jpg');
  assert.deepEqual(summary.price, { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 });
  assert.equal(summary.inStock, true);
});

test('a name in an unrelated locale still resolves, because locales are not trimmed', () => {
  // A catalog seeded only in de-DE, served to an en-US session. `localized`
  // falls through to the first value — but only if that value was returned.
  const projection = shimSearchResult({
    id: 'p1',
    product: {
      id: 'p1',
      masterData: {
        current: {
          nameAllLocales: [{ locale: 'de-DE', value: 'Wollteppich' }],
          slugAllLocales: [{ locale: 'de-DE', value: 'wollteppich' }],
          masterVariant: variant(1),
          allVariants: [variant(1)],
          matched: [],
        },
      },
    },
  });
  assert.equal(toProductSummary(projection, 'en-US').name, 'Wollteppich');
});

test('the discounted price wins, as it does on the REST shape', () => {
  const projection = shimSearchResult(
    entry({
      masterVariant: variant(1, {
        price: {
          value: { centAmount: 10000, currencyCode: 'USD', fractionDigits: 2 },
          discounted: { value: { centAmount: 7500, currencyCode: 'USD', fractionDigits: 2 } },
        },
      }),
      allVariants: [variant(1)],
      matched: [],
    }),
  );
  assert.equal(toProductSummary(projection, 'en-US').price.centAmount, 7500);
});

test('a price selected for no market falls back to the price array', () => {
  // A catalog with no country prices would otherwise render every tile with no
  // price at all; variantPrice falls back to prices[0], so the array is selected.
  const projection = shimSearchResult(
    entry({
      masterVariant: variant(1, { price: undefined }),
      allVariants: [variant(1, { price: undefined })],
      matched: [],
    }),
  );
  assert.equal(toProductSummary(projection, 'en-US').price.centAmount, 1000);
});

test('stock comes off the no-channel branch', () => {
  const out = shimSearchResult(
    entry({
      masterVariant: variant(1, { availability: { noChannel: { isOnStock: false, availableQuantity: 0 } } }),
      allVariants: [variant(1)],
      matched: [],
    }),
  );
  assert.equal(toProductSummary(out, 'en-US').inStock, false);
});

test('a result with no product, or no variants, is skipped rather than throwing', () => {
  assert.equal(shimSearchResult({ id: 'p1' }), undefined);
  assert.equal(shimSearchResult({ id: 'p1', product: null }), undefined);
  assert.equal(shimSearchResult(entry({ allVariants: [], matched: [] })), undefined);
});

// --- errors ----------------------------------------------------------------

test('a GraphQL error list is found on the envelope', () => {
  assert.deepEqual(graphQLErrorsOf({ errors: [{ message: 'nope' }] }), [{ message: 'nope' }]);
  assert.deepEqual(graphQLErrorsOf({ data: {} }), []);
  assert.deepEqual(graphQLErrorsOf(null), []);
  assert.equal(graphQLErrorMessage([{ message: 'a' }, { message: 'b' }]), 'a; b');
});

test('Product Search switched off is recognised through the envelope', () => {
  // HTTP 200 with an errors array, so it never throws and the thrown-error
  // matcher never sees it.
  assert.equal(
    isSearchDisabledGraphQLError([{ message: 'The Product Search API is not enabled for this project.' }]),
    true,
  );
  assert.equal(
    isSearchDisabledGraphQLError([
      { message: 'Product Search is not available', extensions: { code: 'ObjectNotFound' } },
    ]),
    true,
  );
});

test('an unrelated GraphQL error is not a disabled signal', () => {
  // Treating it as "disabled" would tell the shopper the catalog is unavailable
  // on a project whose search works fine.
  assert.equal(
    isSearchDisabledGraphQLError([
      { message: 'Field [x]: Type is missing', extensions: { code: 'InvalidInput' } },
    ]),
    false,
  );
  assert.equal(isSearchDisabledGraphQLError([]), false);
});
