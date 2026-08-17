// Runtime regression tests for store scoping (5.3.0).
//
// The failure mode these guard against is the worst kind: a dealer storefront
// that silently returns the WHOLE catalogue instead of that dealer's products.
// It does not error, it does not look broken, and the assistant confidently
// offers stock the dealer does not sell at prices that are not theirs.
//
// Nothing here type-checks its way to safety — dropping the productSelections
// filter, or forgetting to AND it with the relevance expression, compiles
// perfectly and just quietly widens the catalogue.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStoreScope,
  buildProductSearchBody,
  buildProjectionParameters,
  buildRelevanceQuery,
} from '../../dist/chat/tools/relevance.js';
import { createBuiltinToolSource } from '../../dist/chat/tools/builtin.js';

const DEALER = {
  storeKey: 'dealer-berlin',
  distributionChannelId: 'dc-1',
  productSelectionId: 'ps-1',
};

test('a plain B2C catalogue pays nothing for store scoping', () => {
  const q = buildRelevanceQuery('rug', { locale: 'en-US' });
  assert.deepEqual(applyStoreScope(q, undefined), q, 'unchanged with no scope');
  assert.deepEqual(applyStoreScope(q, {}), q, 'unchanged with an empty scope');
  assert.deepEqual(
    applyStoreScope(q, { storeKey: 'x', distributionChannelId: 'y' }),
    q,
    'a store without a selection adds no filter',
  );

  const params = buildProjectionParameters('USD', 'US');
  assert.equal(params.storeProjection, undefined);
  assert.equal(params.priceChannel, undefined);
});

test('storeProjection and priceChannel are set for a dealer', () => {
  const params = buildProjectionParameters('EUR', 'DE', DEALER);
  assert.equal(params.storeProjection, 'dealer-berlin', 'tailoring + implicit selection');
  assert.equal(params.priceChannel, 'dc-1', 'dealer pricing');
  assert.equal(params.priceCurrency, 'EUR');
  assert.equal(params.priceCountry, 'DE');
});

test('priceChannel is omitted when there is no distribution channel', () => {
  const params = buildProjectionParameters('USD', 'US', { storeKey: 'k' });
  assert.equal(params.storeProjection, 'k');
  assert.ok(!('priceChannel' in params), 'must not send priceChannel: undefined');
});

// Belt-and-suspenders: storeProjection carries an *implicit* selection
// restriction, but if the projection is missing or misconfigured the query would
// fall back to the whole catalogue. The explicit filters make that impossible.
test('the product selection is filtered explicitly, on both product and variant', () => {
  const scoped = applyStoreScope(buildRelevanceQuery('rug', { locale: 'en-US' }), DEALER);

  assert.ok(Array.isArray(scoped.and), 'relevance is AND-ed with the selection filters');
  const exacts = scoped.and.filter((c) => c.exact);
  assert.deepEqual(
    exacts.map((c) => c.exact.field).sort(),
    ['productSelections', 'variants.productSelections'],
    'a selection can be variant-scoped, so both fields are filtered',
  );
  for (const c of exacts) assert.equal(c.exact.value, 'ps-1');

  // The relevance expression must survive intact inside the AND.
  const relevance = scoped.and.find((c) => c.or);
  assert.ok(relevance, 'the boosted OR group is still there');
  assert.equal(relevance.or[0].fullText.boost, 3, 'and still boosted');
});

test('buildProductSearchBody threads the scope end to end', () => {
  const body = buildProductSearchBody('rug', {
    locale: 'en-US',
    currency: 'EUR',
    country: 'DE',
    ...DEALER,
  });

  assert.equal(body.productProjectionParameters.storeProjection, 'dealer-berlin');
  assert.equal(body.productProjectionParameters.priceChannel, 'dc-1');
  assert.ok(body.query.and, 'query is scoped');
  assert.equal(
    body.query.and.filter((c) => c.exact?.field?.includes('productSelections')).length,
    2,
  );
  // Scope keys must not leak into the body as top-level junk.
  for (const k of ['storeKey', 'distributionChannelId', 'productSelectionId']) {
    assert.ok(!(k in body), `${k} must not appear at the top level`);
  }
});

// --- handler-level, through a recording stub -------------------------------

function stub(results = []) {
  const calls = [];
  const exec = () => ({ execute: async () => ({ body: { results, total: results.length } }) });
  const rec = (op, payload) => {
    calls.push({ op, ...payload });
    return exec();
  };
  const b = {
    products: () => ({ search: () => ({ post: ({ body }) => rec('search', { body }) }) }),
    productProjections: () => ({
      withId: () => ({ get: (a) => rec('byId', a) }),
      get: (a) => rec('list', a),
    }),
    categories: () => ({ get: (a) => rec('categories', a) }),
    inventory: () => ({ get: (a) => rec('inventory', a) }),
    channels: () => ({ get: (a) => rec('channels', a) }),
    carts: () => ({ withId: ({ ID }) => ({ get: () => rec('cart', { ID }) }) }),
    orders: () => ({ get: (a) => rec('orders', a) }),
    shippingMethods: () => ({ matchingCart: () => ({ get: (a) => rec('ship', a) }) }),
  };
  return { root: { ...b, inStoreKeyWithStoreKeyValue: () => b }, calls };
}

const dealerCtx = { language: 'de-DE', session: { currency: 'EUR', country: 'DE', ...DEALER } };

test('search_products on a dealer session scopes to the selection', async () => {
  const { root, calls } = stub();
  const { toolRegistry } = createBuiltinToolSource({ apiRoot: root });

  await toolRegistry.search_products({ query: 'bagger' }, dealerCtx);

  const body = calls.find((c) => c.op === 'search').body;
  assert.equal(body.productProjectionParameters.storeProjection, 'dealer-berlin');
  assert.equal(
    body.query.and.filter((c) => c.exact?.value === 'ps-1').length,
    2,
    'the dealer cannot be shown products outside their selection',
  );
});

test('get_product_details on a dealer session uses the store projection', async () => {
  const { root, calls } = stub([{ id: 'p1', name: { 'de-DE': 'Bagger' }, masterVariant: { id: 1 } }]);
  const { toolRegistry } = createBuiltinToolSource({ apiRoot: root });

  await toolRegistry.get_product_details({ productId: 'p1' }, dealerCtx);

  const q = calls.find((c) => c.op === 'byId').queryArgs;
  assert.equal(q.storeProjection, 'dealer-berlin', 'tailored name/image');
  assert.equal(q.priceChannel, 'dc-1', 'dealer price, not the master catalogue price');
});

test('find_stores requires an address, so channels are not mistaken for stores', async () => {
  const { root, calls } = stub();
  const { toolRegistry } = createBuiltinToolSource({ apiRoot: root });

  await toolRegistry.find_stores({}, dealerCtx);

  const where = calls.find((c) => c.op === 'channels').queryArgs.where;
  assert.match(where, /address is defined/,
    'without this, "Monthly Subscription" comes back as a store');
  assert.match(where, /roles contains any/);
});

test('check_stock scopes to the store shelf when the session has a channel', async () => {
  const { root, calls } = stub();
  const { toolRegistry } = createBuiltinToolSource({ apiRoot: root });

  await toolRegistry.check_stock({ skus: ['A-1'] }, {
    ...dealerCtx,
    session: { ...dealerCtx.session, supplyChannelId: 'sc-9' },
  });
  assert.match(calls.at(-1).queryArgs.where, /supplyChannel\(id="sc-9"\)/);

  // …and stays project-wide when it does not.
  const plain = stub();
  await createBuiltinToolSource({ apiRoot: plain.root })
    .toolRegistry.check_stock({ skus: ['A-1'] }, { language: 'en-US', session: {} });
  assert.ok(
    !/supplyChannel/.test(plain.calls.at(-1).queryArgs.where),
    'a B2C session must not get a bogus channel predicate',
  );
});

test('a malicious productSelectionId cannot break the predicate', async () => {
  const { root, calls } = stub();
  const { toolRegistry } = createBuiltinToolSource({ apiRoot: root });

  await toolRegistry.check_stock({ skus: ['A-1'] }, {
    language: 'en-US',
    session: { currency: 'USD', country: 'US', supplyChannelId: '" or 1=1 or id="' },
  });

  assert.match(calls.at(-1).queryArgs.where, /\\"/, 'escaped');
});
