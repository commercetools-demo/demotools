// Runtime regression tests for Product Search query construction.
//
// These run against `dist/`, so `npm run build` must come first — see the
// `verify` script. They are runtime, not type-level, because every bug this file
// guards against type-checks perfectly:
//
//   - a lost `boost` still compiles, and silently returns a nightstand for
//     "wool rugs" because a description match now outranks a name match
//   - a lost `mustMatch: 'any'` still compiles, and silently drops recall on
//     every multi-word query
//   - `normalizeSearchTerm` returning '' still compiles, and turns a filtered
//     search into a match-all page
//
// The relevance expression here is the one the hand-written search used before
// a demo moved its read tools to a Managed MCP Server. Losing it is what made
// "wool rugs" come back as a nightstand, a bowl and a painting.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProductSearchBody,
  buildRelevanceQuery,
  normalizeLimit,
  normalizeSearchTerm,
} from '../../dist/chat/tools/relevance.js';

test('buildRelevanceQuery keeps the boosted multi-field expression', () => {
  const q = buildRelevanceQuery('wool rug', { locale: 'en-US' });

  assert.equal(q.or.length, 4, 'name + searchKeywords + slug + sku');

  const [name, keywords, slug, sku] = q.or;

  assert.equal(name.fullText.field, 'name');
  assert.equal(name.fullText.boost, 3, 'a name match must outrank a keywords match');
  assert.equal(name.fullText.language, 'en-US');
  assert.equal(name.fullText.mustMatch, 'any', 'multi-word queries need recall');

  assert.equal(keywords.fullText.field, 'searchKeywords');
  assert.equal(keywords.fullText.boost, 2);

  assert.equal(slug.wildcard.value, '*wool rug*');
  assert.equal(slug.wildcard.caseInsensitive, true);

  assert.equal(sku.exact.field, 'variants.sku', 'so "do you have IH-9021" works');
  assert.equal(sku.exact.caseInsensitive, true);
});

test('buildRelevanceQuery honours boost and match overrides', () => {
  const q = buildRelevanceQuery('rug', {
    locale: 'en-US',
    nameBoost: 9,
    keywordsBoost: 5,
    matchSlug: false,
    matchSku: false,
  });
  assert.equal(q.or.length, 2);
  assert.equal(q.or[0].fullText.boost, 9);
  assert.equal(q.or[1].fullText.boost, 5);
});

test('buildRelevanceQuery trims the term', () => {
  const q = buildRelevanceQuery('  wool rug \n', { locale: 'en-US' });
  assert.equal(q.or[0].fullText.value, 'wool rug');
  assert.equal(q.or[2].wildcard.value, '*wool rug*');
});

// The model does not reliably send a plain string. It sends the Product Search
// wire shape, often with the query expression hoisted to the top level instead
// of nested under `query` — at which point the server sees no query at all and
// returns a match-all page. That reads as bad relevance; it is a dropped filter.
test('normalizeSearchTerm digs the term out of every shape the model sends', () => {
  const cases = [
    ['plain string', 'wool rug'],
    ['{query}', { query: 'wool rug' }],
    ['{searchTerm}', { searchTerm: 'wool rug' }],
    ['{text}', { text: 'wool rug' }],
    ['hoisted fullText', { fullText: { value: 'wool rug' }, limit: 6 }],
    ['nested query expression', { query: { fullText: { value: 'wool rug' } } }],
    ['or-expression', { or: [{ fullText: { value: 'wool rug' } }] }],
    ['body wrapper', { body: { query: 'wool rug' } }],
  ];

  for (const [label, input] of cases) {
    assert.equal(normalizeSearchTerm(input), 'wool rug', label);
  }
});

test('normalizeSearchTerm returns empty for nothing usable', () => {
  for (const input of [{ limit: 6 }, {}, null, undefined, 42, '   ']) {
    assert.equal(normalizeSearchTerm(input), '');
  }
});

test('normalizeLimit clamps model-supplied counts', () => {
  assert.equal(normalizeLimit(undefined), 6, 'default');
  assert.equal(normalizeLimit(12), 12);
  assert.equal(normalizeLimit(999), 24, 'clamped to max');
  assert.equal(normalizeLimit(-3), 6, 'negative falls back');
  assert.equal(normalizeLimit(0), 6, 'zero falls back');
  assert.equal(normalizeLimit('8'), 8, 'numeric string');
  assert.equal(normalizeLimit('lots'), 6, 'garbage falls back');
  assert.equal(normalizeLimit(4.7), 4, 'floored');
  assert.equal(normalizeLimit(undefined, 20, 50), 20, 'custom default');
});

test('buildProductSearchBody sets price selection and relevance sort', () => {
  const body = buildProductSearchBody('wool rug', {
    locale: 'en-US',
    currency: 'USD',
    country: 'US',
  });

  assert.equal(body.limit, 6);
  assert.equal(body.offset, 0);
  assert.equal(
    body.markMatchingVariants,
    true,
    'a SKU search must show the variant that matched, not the master',
  );
  assert.deepEqual(body.sort, [{ field: 'score', order: 'desc' }]);
  assert.equal(body.productProjectionParameters.priceCurrency, 'USD');
  assert.equal(body.productProjectionParameters.priceCountry, 'US');
  assert.ok(body.query.or, 'carries the boosted expression');
});
