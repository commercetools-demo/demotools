// @ct-demos/demotools/chat/tools — the built-in (non-MCP) commerce tool pack.
//
// Server-only: builds a commercetools client from the app's CTP_* env vars.
// Keep out of 'use client' files.
//
// Zero-wiring usage — the tools read the same credentials as the storefront:
//
//   // site/app/api/chat/route.ts
//   import { makeChatRoute } from '@ct-demos/demotools/chat/server';
//   import { createBuiltinToolSource } from '@ct-demos/demotools/chat/tools';
//
//   export const POST = makeChatRoute({
//     builtinToolSource: createBuiltinToolSource(),   // ← that's it
//     tools, toolRegistry,                            // your write-side tools
//     getSession, buildSystemPrompt, chatComplete,
//   });
//
// Sharing the app's client instead of building a second one:
//
//   createBuiltinToolSource({ apiRoot })
//
// See ./relevance.ts for why this module exists at all — a Managed MCP Server's
// generic read tools lose the boosted name/searchKeywords/slug/SKU expression
// that makes catalog search usable on a demo catalog.

export {
  BUILTIN_TOOL_NAMES,
  createBuiltinToolSource,
  type BuiltinToolName,
  type BuiltinToolSourceOptions,
} from './builtin.js';

export {
  buildApiRootFromEnv,
  defaultSessionFromContext,
  envSessionDefaults,
  getApiRoot,
  MissingCtEnvError,
  resetApiRoot,
  type BuiltinSession,
  type CtApiRoot,
} from './client.js';

export {
  applyStoreScope,
  buildProductSearchGraphQL,
  buildProjectionParameters,
  buildRelevanceQuery,
  normalizeLimit,
  normalizeSearchTerm,
  type ProductSearchBodyOptions,
  type ProductSearchQuery,
  type RelevanceQueryOptions,
  type StoreScope,
} from './relevance.js';

export {
  PRODUCT_SEARCH_DOCUMENT,
  buildSearchVariables,
  graphQLErrorMessage,
  graphQLErrorsOf,
  isSearchDisabledGraphQLError,
  localizedFromAllLocales,
  shimSearchResult,
  type GraphQLErrorEntry,
  type GraphQLProductsSearchResponse,
  type GraphQLSearchResultEntry,
  type ProductSearchGraphQLVariables,
} from './product-search-gql.js';

export {
  cartPayload,
  categoryPayload,
  defaultMoneyFormatter,
  inventoryPayload,
  localized,
  orderPayload,
  productPayload,
  shippingMethodPayload,
  storePayload,
  toCartLineSummary,
  toCartSummary,
  toOrderSummary,
  toProductSummary,
} from './mappers.js';
