// Runtime regression tests for isProductSearchDisabledError().
//
// These run against `dist/`, so `npm run build` must come first — see the
// `verify` script. They are runtime, not type-level, because every shape below
// type-checks perfectly: the matcher takes `unknown`, so a clause that has
// stopped matching still compiles and still returns a boolean.
//
// What this function decides is whether a storefront degrades or crashes. When
// it returns true, the PLP renders an empty grid plus a setup banner; when it
// returns false, the error propagates and Next.js renders the full-page
// "Something went wrong" boundary. So a missed shape is not a subtle
// regression — it is a demo that looks broken.
//
// The three true-shapes are transcribed from real commercetools responses. The
// 404 one was observed on a freshly seeded project on 2026-08-31, and is the
// reason this file exists: the endpoint answered 404 ResourceNotFound with the
// message `Project "<key>" does not exist` for over an hour while the newly
// activated index built, even though the project plainly existed and every
// other call in the same request succeeded.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isProductSearchDisabledError } from '../../dist/ct/server/product-search.js';

/** Product Search never activated on the project. CT answers 400. */
function notEnabled() {
  const message =
    'The Product Search API is not enabled for this project. ' +
    'See https://docs.commercetools.com/api/projects/product-search';
  return Object.assign(new Error(message), {
    statusCode: 400,
    body: {
      statusCode: 400,
      message,
      errors: [{ code: 'InvalidInput', message }],
    },
  });
}

/** The `ObjectNotFound` flavour, where the code is right but overloaded. */
function objectNotFound() {
  const message = 'Product Search is not available for this project.';
  return Object.assign(new Error(message), {
    statusCode: 400,
    body: {
      statusCode: 400,
      message,
      errors: [{ code: 'ObjectNotFound', message }],
    },
  });
}

/**
 * Activated, but the index is still building. The message is simply wrong: the
 * project exists. This is the shape the matcher used to miss.
 */
function indexStillBuilding(projectKey = 'specialized-poc') {
  const message = `Project "${projectKey}" does not exist.`;
  return Object.assign(new Error(message), {
    statusCode: 404,
    body: {
      statusCode: 404,
      message,
      errors: [{ code: 'ResourceNotFound', message }],
    },
  });
}

/**
 * The error that must NOT be swallowed: a genuinely missing resource. Same
 * status, same `ResourceNotFound` code, different message — which is exactly
 * why the 404 clause is anchored on the message and not on the status alone.
 */
function missingProductByKey() {
  const message =
    "The Product with key 'no-such-product' was not found.";
  return Object.assign(new Error(message), {
    statusCode: 404,
    body: {
      statusCode: 404,
      message,
      errors: [{ code: 'ResourceNotFound', message }],
    },
  });
}

test('matches the 400 "Product Search API is not enabled" error', () => {
  assert.equal(isProductSearchDisabledError(notEnabled()), true);
});

test('matches ObjectNotFound carrying a Product Search message', () => {
  assert.equal(isProductSearchDisabledError(objectNotFound()), true);
});

test('matches the 404 index-still-building error despite the wrong message', () => {
  assert.equal(isProductSearchDisabledError(indexStillBuilding()), true);
});

test('matches index-still-building for any project key', () => {
  for (const key of ['specialized-poc', 'vibe-demo-1', 'a', 'has-many-hyphens-99']) {
    assert.equal(
      isProductSearchDisabledError(indexStillBuilding(key)),
      true,
      `project key ${key} should match`,
    );
  }
});

test('does NOT swallow an unrelated 404 with the same ResourceNotFound code', () => {
  assert.equal(isProductSearchDisabledError(missingProductByKey()), false);
});

test('does NOT swallow unrelated failures', () => {
  // A 403 from a client missing the `view_published_products` scope, a 500, a
  // network error with no body, and the degenerate inputs.
  const forbidden = Object.assign(new Error('insufficient_scope'), {
    statusCode: 403,
    body: { statusCode: 403, message: 'insufficient_scope', errors: [{ code: 'insufficient_scope' }] },
  });
  const serverError = Object.assign(new Error('Internal Server Error'), { statusCode: 500 });
  const networkError = new Error('fetch failed');

  assert.equal(isProductSearchDisabledError(forbidden), false);
  assert.equal(isProductSearchDisabledError(serverError), false);
  assert.equal(isProductSearchDisabledError(networkError), false);
  assert.equal(isProductSearchDisabledError(undefined), false);
  assert.equal(isProductSearchDisabledError(null), false);
  assert.equal(isProductSearchDisabledError({}), false);
});

test('reads the message from `body.message` or the bare `message`', () => {
  // Some SDK middleware surfaces the error without a parsed body.
  assert.equal(
    isProductSearchDisabledError({ statusCode: 404, message: 'Project "x" does not exist.' }),
    true,
  );
  assert.equal(
    isProductSearchDisabledError({ statusCode: 404, message: 'Something else entirely.' }),
    false,
  );
});
