// Runtime regression tests for the built-in commerce tool pack.
//
// The `apiRoot` option exists so an app can share its own client; it also makes
// the pack testable without credentials or a live project, which is what these
// tests use. The stub records every call so the assertions can be about the
// *request* rather than about a mocked response.
//
// Three properties are load-bearing and none of them type-check:
//
//   1. **Session identifiers are injected over the model's.** A model that passes
//      `cartId` for someone else's cart must be ignored, not obeyed.
//   2. **Model strings are escaped before reaching a predicate.** A SKU with a
//      `"` in it must not be able to append predicate clauses.
//   3. **Handlers never throw.** `runChatTurn` calls them without a try/catch, so
//      a rejected commercetools call must come back as `isError`, not kill the turn.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createBuiltinToolSource } from '../../dist/chat/tools/builtin.js';

/** Chainable apiRoot stub that records requests and returns canned bodies. */
function stubApiRoot({ results = [], total = 0, cart, fail } = {}) {
  const calls = [];
  const exec = (kind) => ({
    execute: async () => {
      if (fail) throw new Error(fail);
      if (kind === 'cart') return { body: cart ?? { id: 'c1', lineItems: [], totalPrice: null } };
      if (kind === 'productById') return { body: results[0] ?? {} };
      return { body: { results, total } };
    },
  });
  const record = (op, payload, kind) => {
    calls.push({ op, ...payload });
    return exec(kind);
  };

  const builders = {
    products: () => ({ search: () => ({ post: ({ body }) => record('productSearch', { body }, 'search') }) }),
    productProjections: () => ({
      withId: ({ ID }) => ({ get: (a = {}) => record('productById', { ID, ...a }, 'productById') }),
      get: (a = {}) => record('productProjections', a, 'list'),
    }),
    categories: () => ({ get: (a = {}) => record('categories', a, 'list') }),
    inventory: () => ({ get: (a = {}) => record('inventory', a, 'list') }),
    channels: () => ({ get: (a = {}) => record('channels', a, 'list') }),
    carts: () => ({ withId: ({ ID }) => ({ get: () => record('cart', { ID }, 'cart') }) }),
    orders: () => ({ get: (a = {}) => record('orders', a, 'list') }),
    shippingMethods: () => ({ matchingCart: () => ({ get: (a = {}) => record('shippingMethods', a, 'list') }) }),
  };

  const root = {
    ...builders,
    inStoreKeyWithStoreKeyValue: ({ storeKey }) => {
      calls.push({ op: 'inStore', storeKey });
      return builders;
    },
  };

  return { root, calls };
}

const ctx = (session = {}) => ({ language: 'en-US', session: { currency: 'USD', country: 'US', ...session } });

function pack(apiRoot, opts = {}) {
  return createBuiltinToolSource({ apiRoot, ...opts });
}

test('all eight read tools are exposed by default, with no wiring', () => {
  const { root } = stubApiRoot();
  const { tools } = pack(root);
  assert.deepEqual(
    tools.map((t) => t.function.name).sort(),
    [
      'browse_categories',
      'check_stock',
      'find_my_orders',
      'find_stores',
      'get_product_details',
      'search_products',
      'shipping_options',
      'view_cart',
    ],
  );
});

test('include / exclude / rename shape the exposed surface', () => {
  const { root } = stubApiRoot();

  assert.deepEqual(
    pack(root, { include: ['search_products', 'view_cart'] }).tools.map((t) => t.function.name).sort(),
    ['search_products', 'view_cart'],
  );

  assert.ok(
    !pack(root, { exclude: ['find_stores'] }).tools.some((t) => t.function.name === 'find_stores'),
  );

  const renamed = pack(root, { rename: { search_products: 'catalog_search' } });
  assert.ok(renamed.tools.some((t) => t.function.name === 'catalog_search'));
  // Registered under both, because the model sometimes echoes the original name.
  assert.equal(typeof renamed.toolRegistry.catalog_search, 'function');
  assert.equal(typeof renamed.toolRegistry.search_products, 'function');
});

test('search_products recovers from the hoisted-query shape and boosts relevance', async () => {
  const { root, calls } = stubApiRoot({
    results: [
      {
        productProjection: {
          id: 'p1',
          name: { 'en-US': 'Kalso Wool Rug' },
          slug: { 'en-US': 'kalso-wool-rug' },
          masterVariant: { id: 1, sku: 'RUG-1', images: [{ url: 'https://x/i.jpg' }], price: { value: { centAmount: 129900, currencyCode: 'USD', fractionDigits: 2 } } },
        },
      },
    ],
    total: 1,
  });

  const { toolRegistry } = pack(root);
  // The wire shape the model actually emits, not a plain string.
  const res = await toolRegistry.search_products({ fullText: { value: 'wool rug' }, limit: 3 }, ctx());

  assert.ok(!res.isError, JSON.stringify(res.toolPayload));
  assert.equal(res.artifacts.products.length, 1);
  assert.equal(res.artifacts.products[0].name, 'Kalso Wool Rug');
  assert.equal(res.toolPayload.products[0].priceDisplay, '$1,299.00', 'formatted for the model to quote');
  assert.equal(res.toolPayload.products[0].priceMinorUnits, 129900);

  const body = calls.find((c) => c.op === 'productSearch').body;
  assert.equal(body.limit, 3, 'limit survived the odd argument shape');
  assert.equal(body.query.or[0].fullText.boost, 3, 'boosted expression, not a bare fullText');
});

// --- Property 1: session injection -----------------------------------------

test('view_cart reads the SESSION cart and ignores a model-supplied id', async () => {
  const { root, calls } = stubApiRoot({ cart: { id: 'session-cart', lineItems: [], totalPrice: { centAmount: 0, currencyCode: 'USD', fractionDigits: 2 } } });
  const { toolRegistry } = pack(root);

  await toolRegistry.view_cart({ cartId: 'someone-elses-cart' }, ctx({ cartId: 'session-cart' }));

  const call = calls.find((c) => c.op === 'cart');
  assert.equal(call.ID, 'session-cart', "the model's cart id must be discarded");
});

test('find_my_orders scopes to the session customer', async () => {
  const { root, calls } = stubApiRoot({ results: [] });
  const { toolRegistry } = pack(root);

  await toolRegistry.find_my_orders({ customerId: 'victim', limit: 5 }, ctx({ customerId: 'me-123' }));

  const where = calls.find((c) => c.op === 'orders').queryArgs.where;
  assert.equal(where, 'customerId="me-123"');
  assert.ok(!where.includes('victim'), "the model's customer id must not appear");
});

test('no cart and no login degrade gracefully without calling commercetools', async () => {
  const { root, calls } = stubApiRoot();
  const { toolRegistry } = pack(root);

  const cart = await toolRegistry.view_cart({}, ctx());
  assert.ok(!cart.isError);
  assert.equal(cart.toolPayload.itemCount, 0);

  const orders = await toolRegistry.find_my_orders({}, ctx());
  assert.ok(!orders.isError);
  assert.deepEqual(orders.toolPayload.orders, []);

  assert.equal(calls.length, 0, 'nothing to ask commercetools about');
});

// --- Property 2: predicate escaping ----------------------------------------

test('a malicious SKU cannot break out of the predicate', async () => {
  const { root, calls } = stubApiRoot({ results: [] });
  const { toolRegistry } = pack(root);

  await toolRegistry.check_stock({ skus: ['A-1', '" or quantityOnStock > 0 or sku="'] }, ctx());

  const where = calls.find((c) => c.op === 'inventory').queryArgs.where;
  assert.ok(where.includes('\\"'), 'the injected quote is escaped');
  assert.ok(
    !/[^\\]" or quantityOnStock/.test(where),
    `predicate was broken out of: ${where}`,
  );
});

test('a malicious SKU is escaped in product lookup too', async () => {
  const { root, calls } = stubApiRoot({ results: [] });
  const { toolRegistry } = pack(root);

  await toolRegistry.get_product_details({ sku: 'X") or (1=1' }, ctx());

  const where = calls.find((c) => c.op === 'productProjections').queryArgs.where;
  assert.ok(where.includes('\\"'), `expected escaping in: ${where}`);
});

test('browse_categories distinguishes top level from children', async () => {
  const { root, calls } = stubApiRoot({ results: [] });
  const { toolRegistry } = pack(root);

  await toolRegistry.browse_categories({}, ctx());
  assert.equal(calls.at(-1).queryArgs.where, 'parent is not defined');

  await toolRegistry.browse_categories({ parentCategoryId: 'cat-1' }, ctx());
  assert.equal(calls.at(-1).queryArgs.where, 'parent(id="cat-1")');
});

test('a store-scoped session uses the in-store endpoints', async () => {
  const { root, calls } = stubApiRoot({ cart: { id: 'c1', lineItems: [], totalPrice: null } });
  const { toolRegistry } = pack(root);

  await toolRegistry.view_cart({}, ctx({ cartId: 'c1', storeKey: 'store-berlin' }));

  assert.equal(calls.find((c) => c.op === 'inStore')?.storeKey, 'store-berlin');
});

// --- Property 3: handlers never throw --------------------------------------

test('a rejected commercetools call becomes isError, not an exception', async () => {
  const { root } = stubApiRoot({ fail: 'ECONNRESET' });
  let reported;
  const { toolRegistry } = pack(root, { onError: (name, e) => (reported = { name, e }) });

  const res = await toolRegistry.search_products({ query: 'rug' }, ctx());

  assert.equal(res.isError, true);
  assert.match(res.toolPayload.error, /search_products failed: ECONNRESET/);
  assert.equal(reported.name, 'search_products', 'the demo can log the failure');
});

test('a bad session extractor is contained', async () => {
  const { root } = stubApiRoot();
  const { toolRegistry } = pack(root, {
    session: () => {
      throw new Error('no session cookie');
    },
  });

  const res = await toolRegistry.view_cart({}, ctx());
  assert.equal(res.isError, true, 'must not propagate out of the handler');
});

test('missing required args are reported, not thrown', async () => {
  const { root } = stubApiRoot();
  const { toolRegistry } = pack(root);

  assert.equal((await toolRegistry.search_products({}, ctx())).isError, true);
  assert.equal((await toolRegistry.get_product_details({}, ctx())).isError, true);
  assert.equal((await toolRegistry.check_stock({}, ctx())).isError, true);
});

test('SKUs with no inventory entry are untracked, not out of stock', async () => {
  const { root } = stubApiRoot({ results: [{ sku: 'A-1', availableQuantity: 4, quantityOnStock: 4 }] });
  const { toolRegistry } = pack(root);

  const res = await toolRegistry.check_stock({ skus: ['A-1', 'B-2'] }, ctx());

  assert.deepEqual(res.toolPayload.stock, [
    { sku: 'A-1', availableQuantity: 4, inStock: true, supplyChannelId: null },
  ]);
  assert.deepEqual(res.toolPayload.untracked, ['B-2'], 'absent != out of stock');
});
