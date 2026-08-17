/**
 * The built-in read-side commerce tools — the non-MCP half of the tool-source
 * switch.
 *
 * Eight tools: catalog search, product detail, categories, inventory, stores,
 * cart read, order history, shipping options. Same model-facing names the MCP
 * module renames its tools to, so a demo can flip
 * `DEMOTOOLS_CHAT_TOOL_SOURCE` without touching its system prompt.
 *
 * **Zero wiring.** `createBuiltinToolSource()` with no arguments works: the CT
 * client comes from the same `CTP_*` env vars the storefront uses, and the
 * session is read from the context `makeChatRoute` builds by default. Pass
 * `apiRoot` to share the app's existing client (one OAuth token instead of two),
 * or `session` when the session stores its cart id somewhere unusual.
 *
 * Three invariants hold here exactly as they do on the MCP path:
 *
 *   1. **Session identifiers are injected, never accepted.** `view_cart` reads
 *      the session's cart and `find_my_orders` the session's customer; a cart id
 *      or customer id from the model is discarded. The model cannot address
 *      another shopper's data, because it never gets to name whose data it is.
 *   2. **Model strings never reach a predicate unescaped.** SKUs and ids arrive
 *      from the model, and a raw `"` would let it rewrite the query predicate.
 *      Everything interpolated goes through `quote()`.
 *   3. **Handlers do not throw.** `runChatTurn` calls handlers without a
 *      try/catch, so an unhandled rejection would kill the whole turn. Every
 *      handler returns `{ isError: true }` with a short message instead.
 */

import type { Tool, ToolExecutionResult, ToolRegistry } from '../types.js';
import { PRICE_FIELD_GUIDE, type MoneyFormatter } from '../money.js';
import type { ToolSource } from '../server/mcp-tools.js';
import {
  defaultSessionFromContext,
  getApiRoot,
  type BuiltinSession,
  type CtApiRoot,
} from './client.js';
import {
  buildProductSearchBody,
  buildProjectionParameters,
  normalizeLimit,
  normalizeSearchTerm,
} from './relevance.js';
import {
  cartPayload,
  categoryPayload,
  defaultMoneyFormatter,
  inventoryPayload,
  localized,
  orderPayload,
  productPayload,
  shippingMethodPayload,
  storePayload,
  toCartSummary,
  toProductSummary,
} from './mappers.js';

/** Names of the eight read-side tools this module serves. */
export const BUILTIN_TOOL_NAMES = [
  'search_products',
  'get_product_details',
  'browse_categories',
  'check_stock',
  'find_stores',
  'view_cart',
  'find_my_orders',
  'shipping_options',
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export interface BuiltinToolSourceOptions<Ctx = unknown, Extra = Record<string, unknown>> {
  /**
   * The commercetools client. Defaults to one built lazily from the `CTP_*`
   * environment variables — the same ones the storefront reads. Pass the app's
   * own `apiRoot` to share a single OAuth token.
   */
  apiRoot?: CtApiRoot;
  /**
   * Pull locale/currency/country and the session's cart + customer out of ctx.
   * Defaults to reading `{ language, session: { cartId, customerId, … } }`,
   * which is what `makeChatRoute` builds unless `buildToolContext` overrides it.
   */
  session?: (ctx: Ctx) => BuiltinSession;
  /**
   * Formats money for the `*Display` fields. Defaults to `Intl.NumberFormat`
   * over the session's locale + currency. Pass the storefront's own formatter
   * when it does something the demo cares about (e.g. "Price on request").
   */
  formatMoney?: (session: BuiltinSession) => MoneyFormatter;
  /** Expose only these tools. Applied before `exclude` and `rename`. */
  include?: BuiltinToolName[];
  /** Hide these tools. */
  exclude?: BuiltinToolName[];
  /** Built-in name → the name the model sees. Handlers accept both. */
  rename?: Partial<Record<BuiltinToolName, string>>;
  /** Called when a commercetools call rejects, so the demo can log it. */
  onError?: (toolName: BuiltinToolName, error: unknown) => void;
}

type Args = Record<string, unknown>;

/**
 * Escape a value for interpolation into a commercetools query predicate.
 *
 * Model-supplied SKUs land in `sku in (…)`; an unescaped `"` would end the
 * string literal and let the model append predicate clauses of its own.
 */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const DEFINITIONS: Record<BuiltinToolName, Tool> = {
  search_products: {
    type: 'function',
    function: {
      name: 'search_products',
      description:
        'Search the product catalog by free text. Use for any "do you have…", ' +
        '"show me…", or "looking for…" request. Returns product tiles that are ' +
        'displayed to the shopper automatically. ' +
        PRICE_FIELD_GUIDE,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'The shopper\'s search words, e.g. "wool rug" or "oak nightstand". ' +
              'Plain text only — do not pass a query object.',
          },
          limit: { type: 'integer', description: 'How many to return. Default 6, max 24.' },
        },
        required: ['query'],
      },
    },
  },
  get_product_details: {
    type: 'function',
    function: {
      name: 'get_product_details',
      description:
        'Full detail for ONE product the shopper has already been shown — ' +
        'description, variants, stock. Prefer a productId from the current ' +
        'conversation. ' +
        PRICE_FIELD_GUIDE,
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'commercetools product id.' },
          sku: { type: 'string', description: 'Variant SKU, if the id is unknown.' },
        },
      },
    },
  },
  browse_categories: {
    type: 'function',
    function: {
      name: 'browse_categories',
      description:
        'List catalog categories. Use to answer "what do you sell" or to narrow ' +
        'a vague request before searching.',
      parameters: {
        type: 'object',
        properties: {
          parentCategoryId: {
            type: 'string',
            description: 'Omit for top-level categories; pass an id to list children.',
          },
          limit: { type: 'integer', description: 'Default 20.' },
        },
      },
    },
  },
  check_stock: {
    type: 'function',
    function: {
      name: 'check_stock',
      description:
        'Availability for specific SKUs. Use when the shopper asks if something is in stock.',
      parameters: {
        type: 'object',
        properties: {
          skus: {
            type: 'array',
            items: { type: 'string' },
            description: 'One or more variant SKUs.',
          },
        },
        required: ['skus'],
      },
    },
  },
  find_stores: {
    type: 'function',
    function: {
      name: 'find_stores',
      description: 'List physical stores / pickup locations with addresses and coordinates.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: 'Default 20.' } },
      },
    },
  },
  view_cart: {
    type: 'function',
    function: {
      name: 'view_cart',
      description:
        "Read the shopper's current cart — lines, quantities and totals. Takes no " +
        'arguments: the cart is resolved from the session. ' +
        PRICE_FIELD_GUIDE,
      parameters: { type: 'object', properties: {} },
    },
  },
  find_my_orders: {
    type: 'function',
    function: {
      name: 'find_my_orders',
      description:
        "The signed-in shopper's recent orders. Takes no identifying arguments: " +
        'the customer is resolved from the session. ' +
        PRICE_FIELD_GUIDE,
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: 'Default 5.' } },
      },
    },
  },
  shipping_options: {
    type: 'function',
    function: {
      name: 'shipping_options',
      description: 'Delivery methods and prices available for the current cart. ' + PRICE_FIELD_GUIDE,
      parameters: { type: 'object', properties: {} },
    },
  },
};

function ok<Extra>(
  toolPayload: unknown,
  artifacts?: ToolExecutionResult<Extra>['artifacts'],
): ToolExecutionResult<Extra> {
  return artifacts ? { toolPayload, artifacts } : { toolPayload };
}

function fail<Extra>(message: string): ToolExecutionResult<Extra> {
  return { toolPayload: { error: message }, isError: true };
}

/**
 * Build the built-in tool source.
 *
 * Returns the same `ToolSource` shape as
 * `createMcpToolSource().getToolSource()`, which is what lets
 * `mergeToolSources` treat the two interchangeably.
 */
export function createBuiltinToolSource<Ctx = unknown, Extra = Record<string, unknown>>(
  opts: BuiltinToolSourceOptions<Ctx, Extra> = {},
): ToolSource<Ctx, Extra> {
  const { apiRoot, session, formatMoney, include, exclude, rename, onError } = opts;

  const getSession =
    session ?? ((ctx: Ctx) => defaultSessionFromContext(ctx));

  const selected = BUILTIN_TOOL_NAMES.filter((name) => {
    if (include && !include.includes(name)) return false;
    if (exclude?.includes(name)) return false;
    return true;
  });

  const tools: Tool[] = [];
  const toolRegistry: ToolRegistry<Ctx, Extra> = {};

  for (const name of selected) {
    const modelName = rename?.[name] ?? name;
    const def = DEFINITIONS[name];

    tools.push({ ...def, function: { ...def.function, name: modelName } });

    const handler = async (rawArgs: unknown, ctx: Ctx): Promise<ToolExecutionResult<Extra>> => {
      const args = (rawArgs ?? {}) as Args;
      try {
        const sess = getSession(ctx);
        const fmt = formatMoney
          ? formatMoney(sess)
          : defaultMoneyFormatter(sess.locale, sess.currency);
        // Resolved inside the try: a missing CTP_* var throws here, and should
        // surface as a tool error rather than taking the turn down.
        const root = apiRoot ?? getApiRoot();
        return await run<Extra>(name, args, sess, root, fmt);
      } catch (e) {
        onError?.(name, e);
        return fail<Extra>(`${name} failed: ${(e as Error)?.message ?? String(e)}`);
      }
    };

    // Registered under both names so a renamed tool still resolves if the model
    // echoes the built-in name back (it sometimes does after a rename).
    toolRegistry[modelName] = handler;
    if (modelName !== name) toolRegistry[name] = handler;
  }

  return { tools, toolRegistry };
}

async function run<Extra>(
  name: BuiltinToolName,
  args: Args,
  session: BuiltinSession,
  apiRoot: CtApiRoot,
  fmt: MoneyFormatter,
): Promise<ToolExecutionResult<Extra>> {
  const { locale, currency, country, storeKey } = session;

  // Store-scoped endpoints for B2B/B2B2C demos, plain ones otherwise.
  const scoped = storeKey
    ? apiRoot.inStoreKeyWithStoreKeyValue({ storeKey })
    : apiRoot;

  switch (name) {
    case 'search_products': {
      // The model frequently sends the Product Search wire shape instead of a
      // string; normalizeSearchTerm digs the term out either way.
      const term = normalizeSearchTerm(args.query ?? args);
      if (!term) return fail<Extra>('No search term supplied.');

      const body = buildProductSearchBody(term, {
        locale,
        currency,
        country,
        limit: normalizeLimit(args.limit),
        // Store scoping. On a plain B2C catalog these are all null and the body
        // is unchanged; on a dealer storefront they are what keeps the
        // assistant inside that dealer's catalogue and pricing.
        storeKey: session.storeKey,
        distributionChannelId: session.distributionChannelId,
        productSelectionId: session.productSelectionId,
      });

      const { body: res } = await apiRoot
        .products()
        .search()
        .post({ body: body as never })
        .execute();

      const products = (res.results ?? [])
        .map((r) => (r.productProjection ? toProductSummary(r.productProjection, locale) : undefined))
        .filter((p): p is NonNullable<typeof p> => p !== undefined);

      return ok<Extra>(
        {
          matchCount: products.length,
          totalMatches: res.total ?? products.length,
          products: products.map((p) => productPayload(p, fmt)),
          note:
            products.length === 0
              ? 'No matches. Suggest a broader term or offer to browse categories.'
              : 'These products are already displayed to the shopper as tiles — summarise, do not re-list every field.',
        },
        { products } as ToolExecutionResult<Extra>['artifacts'],
      );
    }

    case 'get_product_details': {
      const id = typeof args.productId === 'string' ? args.productId : undefined;
      const sku = typeof args.sku === 'string' ? args.sku : undefined;
      if (!id && !sku) return fail<Extra>('Pass either productId or sku.');

      // Same projection parameters as search, so a dealer sees the tailored
      // name/image and their own price rather than the master catalogue's.
      const priceArgs = buildProjectionParameters(currency, country, {
        storeKey: session.storeKey,
        distributionChannelId: session.distributionChannelId,
      });
      let projection;

      if (id) {
        const { body } = await apiRoot
          .productProjections()
          .withId({ ID: id })
          .get({ queryArgs: { staged: false, ...priceArgs } as never })
          .execute();
        projection = body;
      } else {
        const { body } = await apiRoot
          .productProjections()
          .get({
            queryArgs: {
              where: `masterVariant(sku=${quote(sku!)}) or variants(sku=${quote(sku!)})`,
              limit: 1,
              staged: false,
              ...priceArgs,
            } as never,
          })
          .execute();
        projection = body.results?.[0];
      }

      if (!projection?.id) return fail<Extra>('Product not found.');
      const summary = toProductSummary(projection, locale);
      if (!summary) return fail<Extra>('Product could not be read.');

      return ok<Extra>(
        {
          ...productPayload(summary, fmt),
          description: localized(projection.description, locale),
          variantCount: 1 + (projection.variants?.length ?? 0),
        },
        { products: [summary] } as ToolExecutionResult<Extra>['artifacts'],
      );
    }

    case 'browse_categories': {
      const parentId = typeof args.parentCategoryId === 'string' ? args.parentCategoryId : null;
      const { body } = await apiRoot
        .categories()
        .get({
          queryArgs: {
            where: parentId ? `parent(id=${quote(parentId)})` : 'parent is not defined',
            limit: normalizeLimit(args.limit, 20, 50),
          },
        })
        .execute();

      const categories = (body.results ?? []).map((c) => categoryPayload(c, locale));
      return ok<Extra>({
        categoryCount: categories.length,
        categories,
        note: 'Offer two or three of these as next steps rather than reading the whole list.',
      });
    }

    case 'check_stock': {
      const skus = Array.isArray(args.skus)
        ? args.skus.filter((s): s is string => typeof s === 'string')
        : typeof args.sku === 'string'
          ? [args.sku]
          : [];
      if (skus.length === 0) return fail<Extra>('Pass at least one SKU.');

      // A store-scoped session asks about THAT store's shelf, not project-wide
      // stock, so the supply channel is added to the predicate when present.
      const channel = session.supplyChannelId ?? session.distributionChannelId;
      const where = [`sku in (${skus.map(quote).join(', ')})`]
        .concat(channel ? [`supplyChannel(id=${quote(channel)})`] : [])
        .join(' and ');

      const { body } = await apiRoot
        .inventory()
        .get({
          queryArgs: { where, limit: Math.min(skus.length * 4, 100) },
        })
        .execute();

      const entries = (body.results ?? []).map(inventoryPayload);
      const missing = skus.filter((s) => !entries.some((e) => e.sku === s));
      return ok<Extra>({
        stock: entries,
        untracked: missing,
        note: missing.length
          ? 'SKUs under "untracked" have no inventory entry; treat them as available unless told otherwise.'
          : undefined,
      });
    }

    case 'find_stores': {
      // `roles contains any (...)` alone is not a store filter — it matches
      // every distribution/supply channel in the project, so a demo asking
      // "which stores are near me" got back "Distribution Channel" and
      // "Monthly Subscription". A physical location is a channel with an
      // address; require one.
      const { body } = await apiRoot
        .channels()
        .get({
          queryArgs: {
            where:
              'roles contains any ("InventorySupply", "ProductDistribution") and address is defined',
            limit: normalizeLimit(args.limit, 20, 50),
          },
        })
        .execute();

      const stores = (body.results ?? []).map((c) => storePayload(c, locale));
      return ok<Extra>({ storeCount: stores.length, stores });
    }

    case 'view_cart': {
      // Session-injected. Anything the model passed is ignored by construction.
      if (!session.cartId) {
        return ok<Extra>({
          itemCount: 0,
          lines: [],
          note: 'The shopper has no cart yet — nothing has been added.',
        });
      }

      const { body } = await scoped.carts().withId({ ID: session.cartId }).get().execute();
      const cart = toCartSummary(body, locale);
      return ok<Extra>(cartPayload(cart, fmt), {
        cart,
      } as ToolExecutionResult<Extra>['artifacts']);
    }

    case 'find_my_orders': {
      if (!session.customerId) {
        return ok<Extra>({
          orders: [],
          note: 'The shopper is not signed in. Offer to sign in to see order history.',
        });
      }

      const { body } = await scoped
        .orders()
        .get({
          queryArgs: {
            where: `customerId=${quote(session.customerId)}`,
            sort: ['createdAt desc'],
            limit: normalizeLimit(args.limit, 5, 20),
          },
        })
        .execute();

      const orders = (body.results ?? []).map((o) => orderPayload(o, locale, fmt));
      return ok<Extra>({ orderCount: orders.length, orders });
    }

    case 'shipping_options': {
      if (!session.cartId) {
        return fail<Extra>('No cart yet — add something before quoting shipping.');
      }

      const { body } = await apiRoot
        .shippingMethods()
        .matchingCart()
        .get({ queryArgs: { cartId: session.cartId } })
        .execute();

      const options = (body.results ?? []).map((m) => shippingMethodPayload(m, locale, fmt));
      return ok<Extra>({ options });
    }
  }
}
