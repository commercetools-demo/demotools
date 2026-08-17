# @cboyke/demotools

Reusable React components and AI-chat scaffolding for building commercetools
demos.

## Modules

The package exports these subpaths:

| Import path                              | Contents                                       |
|------------------------------------------|------------------------------------------------|
| `@cboyke/demotools`                      | UI components (`JsonViewer`, `JsonModal`)      |
| `@cboyke/demotools/chat`                 | Chat types, `ChatActionChips`                  |
| `@cboyke/demotools/chat/server`          | Chat agent loop, route factory, MCP tool source, tool-source flag |
| `@cboyke/demotools/chat/tools`           | Built-in commerce tools + `buildRelevanceQuery` |
| `@cboyke/demotools/tracker`              | `track`/`trackBeacon`, `TrackEvent`, `DemoGate`, `TrackerScripts` |
| `@cboyke/demotools/tracker/server`       | Gate helpers, `createTrackerProxyRoute`, `createGateRoute` |
| `@cboyke/demotools/ct`                   | `ProjectExpiredBanner`, `ProductSearchDisabledBanner`, image config |
| `@cboyke/demotools/ct/server`            | `getSessionSecret`, project-status + product-search resilience |

The `chat/server`, `chat/tools`, `tracker/server` and `ct/server` entrypoints are
server-only — keep them out of `'use client'` files (they bundle the LLM driver,
the commercetools SDK, or Next.js route handlers into the browser).

`chat/tools` is the only subpath that needs `@commercetools/platform-sdk` and
`@commercetools/ts-client` (optional peer deps). Everything else is SDK-free.

See **CLAUDE.md → "Demo-tracker & gate"** for the full integration contract
(the iOS Safari ITP fix, gated vs. track-only modes, and copy-paste wire-up).

## UI components

### `<JsonViewer data={...} />`

A VS Code-styled, searchable, collapsible JSON tree viewer. Useful for
inspecting the live shape of any object (carts, orders, customers, etc.) in a
demo UI.

Features:
- Search (Enter / Shift+Enter to navigate matches)
- Expand all / collapse all
- Copy raw JSON to clipboard
- Auto-expand of paths containing matches
- VS Code Dark+ color palette

### `<JsonModal data={...} title="Cart JSON" />`

A trigger button that opens a fullscreen modal containing a `JsonViewer`.
Drop-in replacement for hand-rolled "show JSON" buttons in demo pages.

| Prop              | Default          | Notes                              |
|-------------------|------------------|------------------------------------|
| `data`            | (required)       | Object to render in the viewer.    |
| `title`           | `"JSON"`         | Header label inside the modal.     |
| `buttonLabel`     | `"JSON"`         | Label on the trigger button.       |
| `buttonClassName` | small slate pill | Override classes on the trigger.   |

## Chat scaffolding

A vendor-neutral chat assistant engine extracted from `b2b-starter` and
`b2c-starter`. It owns the boring/load-bearing parts (agent loop,
system-reminder injection, address-detection, voice loop, audio routes,
presentational components); the demo owns its own tools, system prompt,
context, and branding.

### What's shared (4.0.x)

| Layer | Module |
|---|---|
| Agent loop, system-reminder injection | `runChatTurn` (server) |
| Route factory: `/api/chat` | `makeChatRoute` |
| Route factories: TTS + STT | `makeSpeakRoute`, `makeTranscribeRoute` |
| Voice mic loop (VAD + auto-submit) | `useVoiceLoop` |
| `/api/chat` fetch wrapper | `postChatTurn` |
| Action chips | `<ChatActionChips>` |
| Composer (textarea + send) | `<ChatComposer>` |
| Launcher (round button + "Continue chat" pill) | `<ChatLauncher>` |
| Product tiles (with OOS guard, ref-locked Add) | `<ChatProductTile>`, `<ChatProductRow>` |
| Cart card | `<ChatCartSummary>` |
| Order confirmation card | `<ChatOrderConfirmation>` |
| Shipping address form (with optional email field) | `<ChatAddressForm>` |
| Types: tools, turns, artifacts, addresses | top-level exports |

All components are headless: i18n labels, `formatMoney`, routing primitives,
and hooks (`useChat`, `useCart`, etc.) flow in via props. Each demo wraps
the library component with a 10-line shim that wires up the local hooks.

### commercetools Managed MCP Servers (5.0)

Read-side commerce tools no longer have to be hand-written. Point the chat
engine at a [Managed MCP Server](https://docs.commercetools.com/api/managed-mcp-servers-overview)
and its tools are discovered at runtime, converted to OpenAI function-call
shape, and merged with the demo's local tools.

```ts
import { createMcpToolSource } from '@cboyke/demotools/chat/server';

const mcp = createMcpToolSource<ToolContext>({
  url: process.env.CT_MCP_URL!,            // mcpServer.url from the MCP Server config
  auth: {
    type: 'clientCredentials',
    authUrl: process.env.CTP_AUTH_URL!,
    clientId: process.env.CT_MCP_CLIENT_ID!,
    clientSecret: process.env.CT_MCP_CLIENT_SECRET!,
    scope: process.env.CT_MCP_SCOPE!,      // mcp:{projectKey}:{mcpServerKey}
  },
  rename: { read_product_search: 'search_products', read_carts: 'view_cart' },
  params: { read_carts: { pick: [] } },    // no model-settable parameters
  injectArgs: (tool, args, ctx) =>
    tool === 'read_carts' ? { id: ctx.session.cartId } : undefined,
  mapResult: (tool, payload, ctx) => /* → { artifacts, toolPayload } */,
});

export const POST = makeChatRoute({
  /* … */
  toolSource: mcp.getToolSource,           // remote tools
  tools, toolRegistry,                     // local tools; these win on a name clash
});
```

The client speaks Streamable HTTP JSON-RPC directly (no
`@modelcontextprotocol/sdk` dependency) and handles the `initialize`
handshake, SSE-or-JSON responses, `Mcp-Session-Id` replay and re-init,
OAuth client-credentials caching, and 401 refresh. `tools/list` is cached
per process, so a warm container pays the handshake once, not per turn.

Four options exist because they turn out to be load-bearing in practice:

| Option | Why you need it |
|---|---|
| `injectArgs` | Forces session-derived values (cart id, customer id, currency, locale) **over** whatever the model supplied. A project-wide MCP credential otherwise lets the model read any shopper's cart by passing an id. |
| `params` | Prunes the exposed JSON Schema. Commerce MCP's `read_product_search` alone is ~28 KB of schema; a realistic eight-tool set costs ~12k tokens **per agent-loop iteration**. Pruning to the parameters the model should set cuts that to ~2k. |
| `preflight` | Answers locally when a remote call can only 404 — a guest with no cart, an order lookup from a signed-out visitor. |
| `mapResult` | Turns raw commercetools JSON into the typed artifacts the chat UI renders, and shrinks what goes back to the model. |

`inlineJsonSchemaRefs` flattens the internal `$ref` pointers Commerce MCP
emits, which several function-calling endpoints reject; cycles collapse to a
permissive object.

If the MCP server is unreachable, `makeChatRoute` logs and runs the turn with
the local tools only rather than failing outright.

### Built-in commerce tools + the tool-source flag (5.2)

`/chat/tools` ships the eight read-side commerce tools as real code — catalog
search, product detail, categories, inventory, stores, cart read, order history,
shipping options — and `DEMOTOOLS_CHAT_TOOL_SOURCE` picks which source a demo
uses. **The default is `builtin`; MCP is off unless asked for.**

```ts
// site/app/api/chat/route.ts
import { makeChatRoute } from '@cboyke/demotools/chat/server';
import { createBuiltinToolSource } from '@cboyke/demotools/chat/tools';

export const POST = makeChatRoute({
  builtinToolSource: createBuiltinToolSource(),  // ← no wiring
  tools, toolRegistry,                           // your write-side tools
  toolSource: mcp.getToolSource,                 // optional, only used if the flag says so
  getSession, buildSystemPrompt, chatComplete,
});
```

```bash
DEMOTOOLS_CHAT_TOOL_SOURCE=builtin   # default — MCP never contacted
DEMOTOOLS_CHAT_TOOL_SOURCE=mcp       # MCP only
DEMOTOOLS_CHAT_TOOL_SOURCE=both      # merge; builtin wins on a name collision
```

Unset, empty or unrecognised values resolve to `builtin` — an unparseable flag
must not silently turn on a remote dependency.

**Credentials come from the environment, exactly as the storefront reads them:**
`CTP_PROJECT_KEY`, `CTP_AUTH_URL`, `CTP_API_URL`, `CTP_CLIENT_ID`,
`CTP_CLIENT_SECRET`, `CTP_SCOPES`, plus optional `CTP_STORE_KEY`,
`CTP_DISTRIBUTION_CHANNEL_ID`, `CTP_CURRENCY`, `CTP_COUNTRY`, `CTP_LOCALE`. If
the app can reach commercetools, so can the tools. Pass `apiRoot` to share the
app's existing client instead of building a second one:

```ts
createBuiltinToolSource({ apiRoot })
```

Unlike the storefront's `lib/ct/client.ts`, the client is built **lazily on first
use**, not at module load: this is a library, and importing it must not throw in
a demo running MCP-only or in a build step that never calls a tool.

`@commercetools/platform-sdk` and `@commercetools/ts-client` are **optional peer
dependencies**, needed only by this subpath. `/chat`, `/chat/server`, `/tracker`
and `/ct` stay SDK-free, so an MCP-only consumer is unaffected.

**Precedence, lowest to highest: `mcp` → `builtin` → the app's own
`tools`/`toolRegistry`.** So a demo can adopt the pack and still override one
tool by defining it locally under the same name.

#### Why this exists

The read tools a Managed MCP Server exposes are generic, and generic loses
relevance. The hand-written search built a boosted expression across
`name` (×3), `searchKeywords` (×2), a slug wildcard and an exact SKU match; a
bare `fullText` returns **0 hits** for "wool rug" against a catalog whose
products are named "Kalso Wool Rug", and without boosts a description-level
match outranks a name-level one — "wool rugs" came back as a nightstand, a bowl
and a painting. `buildRelevanceQuery` is that expression, exported on its own so
the MCP path can use it too rather than reinventing it per demo.

`normalizeSearchTerm` handles the other half: the model reliably emits the
Product Search wire shape (`{"fullText":{…},"limit":6}`) with the query hoisted
out of `query`, so the server sees no filter and returns a match-all page. That
reads as bad relevance; it is a dropped filter.

Two invariants match the MCP path. Session identifiers are **injected, never
accepted** — `view_cart` reads the session's cart and `find_my_orders` the
session's customer, so a model passing someone else's id is ignored. And model
strings are escaped before reaching a query predicate.

### Store-scoped catalogs (5.3)

A dealer storefront must only ever show the products that dealer sells. Set
`productSelectionId` on the session (or `CTP_PRODUCT_SELECTION_ID`) and the pack
scopes every read:

```ts
createBuiltinToolSource<ToolContext>({
  session: (ctx) => ({
    locale: ctx.language, currency: 'EUR', country: 'DE',
    cartId: ctx.session.cartId, customerId: ctx.session.customerId,
    storeKey: ctx.session.storeKey,                        // storeProjection
    distributionChannelId: ctx.session.distributionChannelId, // priceChannel
    productSelectionId: ctx.session.productSelectionId,    // catalogue restriction
    supplyChannelId: ctx.session.supplyChannelId,          // store shelf for check_stock
  }),
});
```

Two mechanisms, applied together because they fail differently. `storeProjection`
gives per-store tailoring and an **implicit** Product Selection restriction;
the explicit `productSelections` / `variants.productSelections` filters are
belt-and-suspenders. A store whose selection is attached but whose projection is
missing would otherwise fall back to the whole catalog — and "silently shows
everything" is the worst available failure. Both fields are filtered because a
selection can be variant-scoped.

`buildProjectionParameters` and `applyStoreScope` are exported for callers doing
their own queries. On a plain B2C catalog every scope field is null and the
emitted body is byte-identical to 5.2.

Also in 5.3: `find_stores` now requires `address is defined`. Filtering channels
by role alone matched every distribution/supply channel in the project, so
"which stores are near me" returned *Distribution Channel* and *Monthly
Subscription*. And `check_stock` narrows to the session's supply channel when
there is one, so a store-scoped session asks about that store's shelf rather
than project-wide stock.

### Money in tool payloads (5.1)

Never hand the model a bare `centAmount`. It cannot tell `950000` (pence) from
`950,000` (pounds), and eventually it writes the second one — b2b-starter
shipped a chat reply quoting **£1,100,000** for an excavator whose tile, from
the same tool result, said **£11,000.00**. That demo already had two
system-prompt rules forbidding exactly this. Prose can't disambiguate an
integer; field names and pre-formatting can.

```ts
import { moneyFields, PRICE_FIELD_GUIDE } from '@cboyke/demotools/chat/server';

const fmt = (m: Money) => formatMoney(m, displayLocale); // the demo's own formatter

toolPayload = {
  results: products.map((p) => ({
    id: p.id,
    name: p.name,
    ...moneyFields('price', p.price, fmt), // → priceDisplay: "£9,500.00"
    //                                        priceMinorUnits: 950000
    currency: p.price?.currencyCode ?? null,
  })),
  priceFieldGuide: PRICE_FIELD_GUIDE,
};
```

- `<name>Display` — formatted by the demo's own `formatMoney`, so chat prose
  and the product tile can never disagree. Quotable verbatim.
- `<name>MinorUnits` — the exact integer, for arithmetic. Not readable as a
  currency amount, which is the whole point of the name.
- `PRICE_FIELD_GUIDE` — ship it in the payload under `priceFieldGuide`, so the
  rule sits where the model reads the data. Keep your system-prompt rules too.

`describeMoney(money, fmt)` returns `{ display, minorUnits, currency,
fractionDigits }` when a demo needs the parts rather than spread-ready fields.
Formatters that take `(centAmount, currency)` pass an adapter:
`(m) => formatMoney(m.centAmount, m.currencyCode)`.

### What's NOT shared

Per-demo divergence stays per-demo:
- **Write-side tool implementations** (`add_to_cart`, `submit_order`, …) —
  they bind to each demo's commerce backend (B2B as-associate carts vs. B2C
  anonymous; BU/store pickers vs. payment forms). Read-side tools can come
  from a Managed MCP Server instead — see above.
- **System prompt** — tone, scope, branding.
- **Domain-specific artifact components** — B2B's `ChatStorePicker` /
  `ChatBusinessUnitPicker` and B2C's `ChatPaymentForm` (saved-card picker)
  are intentionally per-demo because the underlying data shapes diverge.

### Held back for v5

These need API design before locking down:
- **`ChatProvider`/`useChat` context** — generics over `UiAction` and
  artifact extras
- **`<ChatPanel>`** — slot-based composition (header brand, voice status
  bar, scroller, composer)
- **`<ChatMessage>` artifact router** — pluggable artifact renderers so
  demos register their own (`ChatStorePicker`, `ChatPaymentForm`, etc.)

### Why share this layer

Roughly 70% of the chat code in our demos was identical: agent loop, voice
loop, Markdown rendering, action chips, OOS guard, ref-locked tile button.
Sharing eliminates a real bug class — a fix landed in b2b on 2026-05-02
and silently went un-ported to b2c for a day before this package existed.
With v4, fixes flow through `npm version patch` and a single dependency
bump.

### Wire-up sketch

A new demo's chat surface is roughly: install `@cboyke/demotools`, write a
`tools.ts` + `system-prompt.ts`, then 6 component shims (~10 lines each)
that pass demo hooks/i18n into the library components.

**`/api/chat/route.ts`** (the explicit form — `makeChatRoute` is also available):

```ts
import OpenAI from 'openai';
import { runChatTurn, type ChatComplete } from '@cboyke/demotools/chat/server';
import { NextResponse } from 'next/server';
import { TOOLS } from '@/lib/chat/tool-defs';
import { executeTool, type ToolContext } from '@/lib/chat/tools';
import { buildSystemPrompt } from '@/lib/chat/system-prompt';
import { getSession } from '@/lib/session';

const openai = new OpenAI();
const chatComplete: ChatComplete = async ({ messages, tools, model }) => {
  const r = await openai.chat.completions.create({
    model: model ?? process.env.CHAT_MODEL ?? 'gpt-4o-mini',
    tools,
    messages: messages as never,
  });
  return { finish_reason: r.choices[0].finish_reason, message: r.choices[0].message as never };
};

const toolRegistry = Object.fromEntries(
  TOOL_NAMES.map((name) => [
    name,
    async (args, ctx) => {
      const r = await executeTool(name, args, ctx as ToolContext);
      return {
        toolPayload: r.toolPayload,
        isError: r.isError,
        setCookies: r.setCookies,
        artifacts: { products: r.products, cart: r.cart, order: r.order /* ... */ },
      };
    },
  ]),
);

export async function POST(request: Request) {
  const session = await getSession();
  const body = await request.json();
  const { setCookies, ...rest } = await runChatTurn({
    messages: body.messages,
    uiActions: body.uiActions ?? [],
    recentProducts: body.recentProducts ?? [],
    language: body.language ?? 'en-US',
    ctx: { session /* ... */ },
    systemPrompt: buildSystemPrompt({ session, language: body.language }),
    tools: TOOLS,
    toolRegistry,
    chatComplete,
  });
  const response = NextResponse.json(rest);
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}
```

**`/api/chat/speak/route.ts`** + **`/transcribe/route.ts`** — 4 lines each:

```ts
import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { makeSpeakRoute } from '@cboyke/demotools/chat/server';

export const POST = makeSpeakRoute({
  openai: new OpenAI() as never,
  NextResponse: NextResponse as never,
});
```

**Component shims** — pass hooks + i18n + formatters to the library
component. Same shape across all 7 components:

```tsx
// site/components/chat/ChatActionChips.tsx
'use client';
import { ChatActionChips as LibChatActionChips } from '@cboyke/demotools/chat';
import { useChat } from '@/context/ChatContext';

export function ChatActionChips({ suggestions }) {
  const { sendMessage, isLoading } = useChat();
  return (
    <LibChatActionChips
      suggestions={suggestions}
      onSelect={(query) => void sendMessage(query)}
      disabled={isLoading}
    />
  );
}
```

```tsx
// site/components/chat/ChatProductTile.tsx
'use client';
import Image from 'next/image';
import Link from 'next/link';
import { ChatProductTile as LibChatProductTile } from '@cboyke/demotools/chat';
import { useChat } from '@/context/ChatContext';
import { useCart } from '@/context/CartContext';
import { useFormatters } from '@/hooks/useFormatters';
import { useTranslations } from 'next-intl';

export function ChatProductTile({ product }) {
  const t = useTranslations('chat');
  const { formatMoney } = useFormatters();
  const { addItem } = useCart();
  const { pushUiAction, sendMessage } = useChat();

  return (
    <LibChatProductTile
      product={product}
      formatMoney={formatMoney}
      labels={{ /* 8 strings */ }}
      pdpHref={pdpHref}
      onAdd={async (p) => {
        await addItem(p.id, p.variantId, 1);
        pushUiAction({ type: 'added_to_cart', productId: p.id, productName: p.name, quantity: 1 });
        void sendMessage('');
      }}
      ImageComponent={Image}
      LinkComponent={Link}
    />
  );
}
```

### Reference consumers

Both demos use the package end-to-end:
- [`commercetools-demo/b2b-starter`](https://github.com/commercetools-demo/b2b-starter/blob/main/site/lib/chat/agent.ts)
- [`commercetools-demo/b2c-starter`](https://github.com/commercetools-demo/b2c-starter/blob/main/site/lib/chat/agent.ts)

See [`src/chat/DESIGN.md`](https://github.com/commercetools-demo/demotools/blob/main/src/chat/DESIGN.md)
for the rationale on what's shared vs. demo-specific and the migration plan
for the held-back surface.

## Installation

```bash
npm install @cboyke/demotools
```

For local development, link from a sibling checkout:

```json
{ "dependencies": { "@cboyke/demotools": "file:../demotools" } }
```

## Tailwind

The UI components ship as compiled JS with Tailwind utility classes embedded as
string literals (e.g. `bg-black/60`, `bg-[#1e1e1e]`, `text-[#9cdcfe]`). Tailwind
only generates CSS for class names it can *see* during its content scan, so you
**must** tell Tailwind to scan this package's `dist/` — otherwise the JSON
modal renders unstyled (no backdrop, no syntax colors, content bleeds onto the
page underneath).

**Tailwind v3** — add the path to `content` in `tailwind.config.js`:

```js
// tailwind.config.js
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
    './node_modules/@cboyke/demotools/dist/**/*.js', // ← required
  ],
  // ...
};
```

**Tailwind v4** — add a `@source` line to your CSS:

```css
@import "tailwindcss";
@source "../node_modules/@cboyke/demotools/dist/**/*.js";
```

After adding the path, restart the dev server (a hot reload of
`tailwind.config.js` isn't always enough — Vite's PostCSS pipeline can hold a
stale content set).

### Smoke test

Open the JSON modal in your demo. If you see a proper dark overlay with a
search bar and VS Code-style syntax colors, you're good. If the JSON tree
appears inline over the page with no backdrop, your content scan is missing
the `dist/` path.

## Versioning

- `3.0.x` — `JsonViewer` + `JsonModal` only.
- `3.1.x` — adds `/chat` and `/chat/server` subpaths (agent loop +
  `ChatActionChips` + types). Existing imports unchanged.
- `4.0.x` — adds the bulk of the chat surface: `useVoiceLoop`,
  `postChatTurn`, `makeSpeakRoute`, `makeTranscribeRoute`,
  `ChatComposer`, `ChatLauncher`, `ChatProductRow`, `ChatProductTile`,
  `ChatCartSummary`, `ChatOrderConfirmation`, `ChatAddressForm`. New
  components require label props (i18n strings), hence the major bump.
- `5.0.x` — adds `/chat/server` Managed MCP Server support:
  `createMcpToolSource`, `McpClient`, `mergeToolSources`, and
  `toolSource` on `makeChatRoute`. Purely additive; `tools`/`toolRegistry`
  became optional.
- `5.1.x` — adds `moneyFields` / `describeMoney` / `PRICE_FIELD_GUIDE`:
  the `*Display` + `*MinorUnits` contract for money in tool payloads.
- `5.2.x` — adds the `/chat/tools` subpath: the eight built-in read-side
  commerce tools, `buildRelevanceQuery` / `normalizeSearchTerm`, and the
  `DEMOTOOLS_CHAT_TOOL_SOURCE` flag (`builtin` default, so **MCP is off unless
  asked for**) with `builtinToolSource` on `makeChatRoute`. Purely additive —
  a 5.1 consumer that sets nothing keeps its exact behaviour, because a demo
  only gets the pack by passing `builtinToolSource`.
  `@commercetools/platform-sdk` + `@commercetools/ts-client` become optional
  peer deps, required only by `/chat/tools`.
- `5.3.x` — store scoping for B2B/B2B2C: `productSelectionId` +
  `supplyChannelId` on `BuiltinSession`, `applyStoreScope` /
  `buildProjectionParameters` exported, `find_stores` restricted to channels
  with an address, `check_stock` scoped to the session's supply channel.
  Additive — a B2C caller that sets no scope fields emits an identical query.
- `6.0.0` (planned) — `ChatProvider` / `useChat` context with generics
  over `UiAction` and artifact extras; slot-based `<ChatPanel>`;
  pluggable `<ChatMessage>` artifact router so demos can register their
  own renderers (`ChatStorePicker`, `ChatPaymentForm`, etc.) under
  known artifact keys.
