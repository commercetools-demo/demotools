/**
 * The commercetools client for the built-in commerce tools.
 *
 * Built from the **same `CTP_*` environment variables the storefronts already
 * use**, so adopting the tool pack needs no wiring at all — if the app can talk
 * to commercetools, so can the tools. This mirrors `site/lib/ct/client.ts` in
 * the starters: `ClientBuilder` → client-credentials flow → `withHttpMiddleware`
 * → `createApiBuilderFromCtpClient(...).withProjectKey(...)`.
 *
 * One deliberate difference from the storefront version. The storefront
 * validates env and builds its client **at module load**, which is right for an
 * app: a misconfigured deploy should fail loudly on boot. This is a *library*,
 * and `import '@cboyke/demotools/chat/tools'` must not throw just because it was
 * imported — a demo running MCP-only, or a build step that touches the module
 * without ever calling a tool, has no credentials and no need for them. So the
 * client is built **lazily on first use** and cached. A missing variable throws
 * at that point, with the same descriptive message.
 *
 * Required:  CTP_PROJECT_KEY, CTP_AUTH_URL, CTP_API_URL,
 *            CTP_CLIENT_ID, CTP_CLIENT_SECRET, CTP_SCOPES
 * Optional:  CTP_STORE_KEY, CTP_DISTRIBUTION_CHANNEL_ID,
 *            CTP_CURRENCY (default USD), CTP_COUNTRY (default US),
 *            CTP_LOCALE (default en-US)
 */

import { createApiBuilderFromCtpClient } from '@commercetools/platform-sdk';
import { ClientBuilder } from '@commercetools/ts-client';

/**
 * The project-scoped request builder — `apiRoot` in every starter.
 *
 * Typed as the return of `withProjectKey` rather than importing
 * `ByProjectKeyRequestBuilder` by name, so a consumer on a different SDK major
 * (the starters are on 8.x, latest is 9.x) doesn't hit a type-identity mismatch
 * on a renamed or relocated export.
 */
export type CtApiRoot = ReturnType<
  ReturnType<typeof createApiBuilderFromCtpClient>['withProjectKey']
>;

export class MissingCtEnvError extends Error {
  constructor(name: string) {
    super(
      `[demotools/chat/tools] Missing required env var ${name}. The built-in ` +
        'commerce tools read the same CTP_* credentials as the storefront — set ' +
        "them in the app's .env (locally) and in the deploy environment. To run " +
        'without them, set DEMOTOOLS_CHAT_TOOL_SOURCE=mcp or supply your own ' +
        '`apiRoot` to createBuiltinToolSource().',
    );
    this.name = 'MissingCtEnvError';
  }
}

function env(): Record<string, string | undefined> {
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

function requireEnv(name: string): string {
  const value = env()[name];
  if (!value) throw new MissingCtEnvError(name);
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = env()[name];
  return value && value.trim() ? value : fallback;
}

let cached: CtApiRoot | undefined;

/** Build a fresh apiRoot from the environment. Prefer `getApiRoot`. */
export function buildApiRootFromEnv(): CtApiRoot {
  const projectKey = requireEnv('CTP_PROJECT_KEY');
  const authUrl = requireEnv('CTP_AUTH_URL');
  const apiUrl = requireEnv('CTP_API_URL');

  const client = new ClientBuilder()
    .withProjectKey(projectKey)
    .withClientCredentialsFlow({
      host: authUrl,
      projectKey,
      credentials: {
        clientId: requireEnv('CTP_CLIENT_ID'),
        clientSecret: requireEnv('CTP_CLIENT_SECRET'),
      },
      scopes: [requireEnv('CTP_SCOPES')],
    })
    .withHttpMiddleware({ host: apiUrl })
    .build();

  return createApiBuilderFromCtpClient(client).withProjectKey({ projectKey });
}

/**
 * The cached apiRoot, built on first call.
 *
 * Cached because `withClientCredentialsFlow` keeps its OAuth token in the client
 * instance — rebuilding per request would re-authenticate on every chat turn.
 */
export function getApiRoot(): CtApiRoot {
  if (!cached) cached = buildApiRootFromEnv();
  return cached;
}

/** Drop the cached client. For tests, and after a credential rotation. */
export function resetApiRoot(): void {
  cached = undefined;
}

/** Session facts the tools need, resolved per request. */
export interface BuiltinSession {
  /** Locale for localized fields and price selection, e.g. "en-US". */
  locale: string;
  /** ISO currency code for price selection, e.g. "USD". */
  currency: string;
  /** ISO country code for price selection, e.g. "US". */
  country: string;
  /**
   * The cart the storefront session points at. **Injected over anything the
   * model supplies** — a model must not be able to read another shopper's cart
   * by passing an id.
   */
  cartId?: string | null;
  /** Signed-in customer, if any. Scopes order history the same way. */
  customerId?: string | null;
  /** Store key for store-scoped catalogs (B2B / B2B2C demos). */
  storeKey?: string | null;
  /** Distribution channel for store-specific pricing. */
  distributionChannelId?: string | null;
}

/** Defaults for price selection, overridden by whatever the session supplies. */
export function envSessionDefaults(): BuiltinSession {
  return {
    locale: optionalEnv('CTP_LOCALE', 'en-US'),
    currency: optionalEnv('CTP_CURRENCY', 'USD'),
    country: optionalEnv('CTP_COUNTRY', 'US'),
    storeKey: env().CTP_STORE_KEY ?? null,
    distributionChannelId: env().CTP_DISTRIBUTION_CHANNEL_ID ?? null,
  };
}

/**
 * Default session extractor.
 *
 * Reads the context shape `makeChatRoute` produces by default —
 * `{ session, language, origin, cookieHeader }` — so the common case needs no
 * `session` option at all. Anything absent falls back to `envSessionDefaults()`.
 * Pass your own extractor when the session stores these elsewhere.
 */
export function defaultSessionFromContext(ctx: unknown): BuiltinSession {
  const defaults = envSessionDefaults();
  const c = (ctx ?? {}) as {
    language?: unknown;
    locale?: unknown;
    session?: Record<string, unknown>;
  };
  const s = (c.session ?? {}) as Record<string, unknown>;

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v : undefined;

  return {
    locale: str(c.language) ?? str(c.locale) ?? str(s.locale) ?? defaults.locale,
    currency: str(s.currency) ?? defaults.currency,
    country: str(s.country) ?? defaults.country,
    cartId: str(s.cartId) ?? null,
    customerId: str(s.customerId) ?? null,
    storeKey: str(s.storeKey) ?? defaults.storeKey,
    distributionChannelId:
      str(s.distributionChannelId) ?? defaults.distributionChannelId,
  };
}
