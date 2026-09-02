# Features

Comprehensive inventory of implemented features in this demo. Source of truth
for what exists in the codebase — keep it updated when features change.

_Last generated: 2026-09-02 by feature-doc._

`@cboyke/demotools` is not a demo app itself — it is a published npm library
(`@cboyke/demotools`, currently `5.9.1`) of reusable React components and
server-side helpers, shared across the commercetools pre-sales demo repos
(b2b-starter, b2c-starter, bridge-provider/patient, etc.) via subpath exports.
No build/dev/test commands were run to produce this document.

## Package shape & subpaths

- Nine independently-importable subpaths (`package.json` → `exports`), each
  with its own `dist/` entry point: `src/index.ts`, `src/chat/index.ts`,
  `src/chat/server/index.ts`, `src/chat/tools/index.ts`,
  `src/tracker/index.ts`, `src/tracker/gate-copy.ts`,
  `src/tracker/server/index.ts`, `src/ct/index.ts`, `src/ct/server/index.ts`.
  `tracker/gate-copy` is the one non-barrel subpath — a standalone,
  dependency-free module carved out so the non-React demo-tracker service can
  import the gate wording directly (see below) without pulling in `DemoGate`'s
  react/react-dom peer deps via the `./tracker` barrel.
- Client-safe vs. server-only boundary is enforced by keeping server code
  (LLM driver, commercetools SDK client, Next.js route handlers, server env
  reads) behind `/server` subpaths, so client bundles never pull it in.
- `@commercetools/platform-sdk` and `@commercetools/ts-client` are **optional
  peer dependencies**, required only by `/chat/tools`; the rest of the package
  is SDK-free so an MCP-only or non-chat consumer isn't forced to install them.
- Ships its own `CLAUDE.md` inside the published package (`files` in
  `package.json`) so it lands in a consumer's `node_modules/@cboyke/demotools/`
  and is readable by an AI assistant wiring the library into a demo.
- Build: `tsc` to `dist/` (`npm run build`); no bundler/minifier. `verify`
  chains typecheck → build → runtime tests and is `prepublishOnly`.
- Publishes to npm via GitHub Actions OIDC Trusted Publishing on push to
  `main` (`.github/workflows/*.yml`), skipping the publish step if the current
  `package.json` version is already on the registry.

## UI components (`@cboyke/demotools`)

- `<JsonViewer data={...} />` (`src/JsonViewer.tsx`) — VS Code Dark+-styled,
  searchable, collapsible JSON tree viewer: Enter/Shift+Enter match
  navigation, expand-all/collapse-all, copy-raw-JSON-to-clipboard, and
  auto-expansion of paths containing a search match. Used for inspecting live
  cart/order/customer shapes in a demo UI.
- `<JsonModal data={...} title="Cart JSON" />` (`src/JsonModal.tsx`) — trigger
  button + fullscreen modal wrapping `JsonViewer`; props for `title`,
  `buttonLabel`, `buttonClassName`. Drop-in replacement for hand-rolled
  "show JSON" debug buttons.
- Both ship as compiled JS with Tailwind utility classes as string literals
  (`bg-black/60`, `bg-[#1e1e1e]`, etc.) — consumers must add the package's
  `dist/**/*.js` to their Tailwind content scan (v3 `content` array or v4
  `@source` line) or the modal renders with no backdrop/syntax colors. This
  is documented at length in both `README.md` and the shipped `CLAUDE.md`
  because it has bitten real consumers.

## Chat assistant scaffolding (`/chat`, `/chat/server`, `/chat/tools`)

A vendor-neutral AI chat-assistant engine extracted from `b2b-starter` and
`b2c-starter` so ~70% of previously-duplicated chat code (agent loop, voice
loop, Markdown rendering, action chips, OOS guard, ref-locked tile button)
lives in one place. The engine owns the load-bearing plumbing; each demo owns
its own write-side tools, system prompt, branding, and context.

### Agent loop & routes
- `runChatTurn` (`src/chat/agent.ts`) — server-side agent loop: system-reminder
  injection, tool-call dispatch against a caller-supplied `toolRegistry`,
  merges local + MCP + built-in tool sources.
- `makeChatRoute` (`src/chat/server/route-factories.ts`) — `/api/chat` Next.js
  route factory taking `tools`/`toolRegistry`, optional `toolSource` (MCP) and
  `builtinToolSource`, `getSession`, `buildSystemPrompt`, `chatComplete`.
- `makeSpeakRoute` / `makeTranscribeRoute` (`src/chat/server/audio-routes.ts`)
  — TTS/STT route factories (OpenAI-backed) for voice chat, ~4 lines to wire.
- Route factories deliberately type their first handler argument as the
  global `Request` (not a structural `RequestLike`), because Next's
  `next-types-plugin` route validator rejects anything else when a factory's
  handler is re-exported directly as `export const GET = handler` — pinned by
  `test/route-types.ts`.

### Presentational components (client, `/chat`)
- `<ChatActionChips>`, `<ChatComposer>` (textarea + send), `<ChatLauncher>`
  (round button + "Continue chat" pill), `<ChatProductTile>` /
  `<ChatProductRow>` (OOS guard, ref-locked Add-to-cart), `<ChatCartSummary>`,
  `<ChatOrderConfirmation>`, `<ChatAddressForm>` (optional email field) — all
  headless: i18n labels, `formatMoney`, routing, and hooks are passed in as
  props so each demo wraps them in a ~10-line shim.
- `useVoiceLoop` (`src/chat/hooks/useVoiceLoop.ts`) — mic loop with VAD
  (voice-activity detection) and auto-submit.
- `useChatApi` / `postChatTurn` (`src/chat/hooks/useChatApi.ts`) — `/api/chat`
  fetch wrapper.

### Managed MCP Server integration (`/chat/server`)
- `createMcpToolSource` (`src/chat/server/mcp-tools.ts`) — points the chat
  engine at a commercetools Managed MCP Server; discovers `tools/list` at
  runtime, converts to OpenAI function-call shape, merges with local tools.
- `McpClient` (`src/chat/server/mcp-client.ts`) — hand-rolled Streamable HTTP
  JSON-RPC client (no `@modelcontextprotocol/sdk` dep): `initialize`
  handshake, SSE-or-JSON response handling, `Mcp-Session-Id` replay/re-init,
  OAuth client-credentials caching + 401 refresh, per-process `tools/list`
  cache.
- `injectArgs` — forces session-derived values (cart id, customer id,
  currency, locale) over model-supplied ones, so a shared MCP credential
  can't be used to read another shopper's cart.
- `params` — prunes exposed JSON Schema (cuts an ~28 KB tool schema to ~2k
  tokens per agent-loop iteration).
- `preflight` — answers locally when a remote call can only 404 (guest with
  no cart, signed-out order lookup).
- `mapResult` — converts raw commercetools JSON into typed chat-UI artifacts.
- `inlineJsonSchemaRefs` — flattens Commerce MCP's internal `$ref` pointers
  that some function-calling endpoints reject.
- If the MCP server is unreachable, `makeChatRoute` logs and falls back to
  running the turn with local tools only, rather than failing the turn.

### Built-in commerce tool pack (`/chat/tools`)
- Eight read-side commerce tools as real (non-MCP) code, in
  `src/chat/tools/builtin.ts`: `search_products`, `get_product_details`,
  `browse_categories`, `check_stock`, `find_stores`, `view_cart`,
  `find_my_orders`, `shipping_options`.
- `createBuiltinToolSource()` — zero-wiring: reads the same `CTP_PROJECT_KEY`,
  `CTP_AUTH_URL`, `CTP_API_URL`, `CTP_CLIENT_ID`, `CTP_CLIENT_SECRET`,
  `CTP_SCOPES` env vars the storefront itself uses (plus optional
  `CTP_STORE_KEY`, `CTP_DISTRIBUTION_CHANNEL_ID`, `CTP_CURRENCY`,
  `CTP_COUNTRY`, `CTP_LOCALE`); can share the app's existing `apiRoot`
  instead of building a second OAuth client. The client is built lazily on
  first tool use, not at module load.
- `DEMOTOOLS_CHAT_TOOL_SOURCE` env flag (`src/chat/server/tool-source.ts`)
  selects `builtin` (default) / `mcp` / `both`; unset/empty/unrecognised
  values resolve to `builtin` so a typo can't silently turn on a remote
  dependency. Precedence low→high: `mcp` → `builtin` → the app's own
  `tools`/`toolRegistry` (a demo can override one packed tool by name).
- `buildRelevanceQuery` / `normalizeSearchTerm` (`src/chat/tools/relevance.ts`)
  — boosted product-search expression (name ×3, searchKeywords ×2, slug
  wildcard, exact SKU match) so catalog search actually surfaces relevant
  hits, versus a bare `fullText` query which returns 0 hits for e.g. "wool
  rug" against "Kalso Wool Rug"; also un-hoists the query when a model emits
  the raw Product Search wire shape.
- Session identifiers (`cartId`, `customerId`) are injected server-side, never
  accepted from the model, in both the built-in and MCP paths.
- **Store-scoped catalogs** (`applyStoreScope`, `buildProjectionParameters` in
  `src/chat/tools/relevance.ts`) — `productSelectionId` +
  `distributionChannelId` + `storeKey` + `supplyChannelId` on the session
  scope every read to a dealer/B2B2C store's own catalog, pricing, and stock;
  `find_stores` requires `address is defined` so it doesn't match every
  distribution/supply channel in the project; `check_stock` narrows to the
  session's supply channel when set. On a plain B2C session every scope field
  is null and the query is unchanged.
- **Money-safe tool payloads** (`moneyFields`, `describeMoney`,
  `PRICE_FIELD_GUIDE` in `src/chat/money.ts`) — every price in a tool payload
  carries both a pre-formatted `<name>Display` string (via the demo's own
  `formatMoney`) and a raw `<name>MinorUnits` integer, plus a
  `priceFieldGuide` in the payload itself, so the model can't misquote a bare
  `centAmount` as a currency amount (a real bug: quoting £1,100,000 for an
  £11,000 item).

## Demo-tracker analytics & password gate (`/tracker`, `/tracker/server`)

Client + server integration with the external demo-tracker service
(analytics + shared-password gate), designed to land a fix once for every
demo consuming the package.

- `track` / `trackBeacon` (`src/tracker/track.ts`), `<TrackEvent>`
  (Server Component-friendly event firing), `<TrackerScripts>`
  (`src/tracker/TrackerScripts.tsx`) — loads the tracker's `t.js` tag
  first-party through a proxy route (`defer`, never `async`, to avoid React 19
  hoisting it above the inline `window.dt` context assignment).
- `track()` degrades gracefully: if `window.dt.track` hasn't been installed
  yet (deferred `t.js` hasn't run), it POSTs the event itself to the
  first-party `/api/tracker/event` proxy instead of silently dropping it —
  fixes a real bug where hard page loads recorded pageviews but not
  `view_category`/`view_product` events.
- `<DemoGate>` (`src/tracker/DemoGate.tsx`) + `DEMO_GATE_COPY` /
  `resolveGateCopy` (`src/tracker/gate-copy.ts`) — the app's own branded
  email + shared-password gate UI, with copy that explicitly distinguishes
  "your email" (no account) from "the shared demo password" (ask whoever sent
  the link), overridable per demo via a `copy` prop.
- **Two base wordings, keyed on site type (5.9.0)** — `EVAL_ROOM_GATE_COPY` /
  `gateCopyForSiteType(siteType)` (`src/tracker/gate-copy.ts`) pick "Evaluation
  room access" copy for `sites.site_type === 'content'` (evaluation rooms /
  content microsites) vs. "Demo access" for everything else; `<DemoGate
  siteType="content" />` selects the base and any `copy` overrides still merge
  on top. `gate-copy.ts` is published as its own React-free, dependency-free
  `@cboyke/demotools/tracker/gate-copy` subpath (distinct from the `./tracker`
  barrel that re-exports `DemoGate`) specifically so the demo-tracker service's
  Netlify edge-gate template and `t.js` in-page overlay — neither a React app —
  can import the exact same copy instead of hand-mirroring three copies that
  drift. Neither surface calls an evaluation room a "demo".
- Two integration modes via `createTrackerProxyRoute({ mode })`: **gated**
  (b2c/b2b — app renders its own `/gate`, authenticates the tracker
  server-side from a `demo_gate` cookie, never exposes `dt_session` to the
  browser) and **track-only** (b2b2c/b2b2b customer — no gate, forwards the
  tracker's anonymous `dt_session`).
- `createGateRoute` (`src/tracker/server/routes.ts`) — admin gate bypass: a CT
  admin clicking a demo-tracker admin link opens the demo pre-gated via a
  5-minute grant JWT, accepted as a `POST … grant` form field (preferred,
  avoids the grant ever appearing in a URL/Referer/browser history on
  Netlify) or a legacy `GET ?t=<grant>` for backward compatibility. The
  returned session is re-validated against the local site slug so a grant
  minted for one demo can't redeem on another.
- Page-builder preview carve-out (`gateVerdict`, `editorPreviewVerdict` in
  `src/tracker/server/gate.ts`) — lets a Site Builder WYSIWYG editor iframe
  preview a gated demo without satisfying the gate: verifies the framing
  `Referer`/`Sec-Fetch-Dest` for the outer document and a `previewToken` for
  same-origin RSC fetches from inside the frame; inert (returns to a plain
  cookie check) when no `preview` config is supplied.
- Gate is inert unless `NODE_ENV === 'production'` and a tracker slug
  (`NEXT_PUBLIC_DEMO_TRACKER_SITE`) is set; `NEXT_PUBLIC_DEMO_TRACKER_URL` is
  optional (defaults to `https://tracker.ctdemo.net`) and only the slug drives
  both the gate and script loading, so the two can't disagree.
- Cookie is `demo_gate`, `SameSite=Lax`, with a same-site self-heal — chosen
  specifically to avoid iOS Safari ITP reclassifying the site as a bounce
  tracker (which would happen with a cross-origin tracker request or a
  `SameSite=Strict` cookie).

## commercetools resilience helpers (`/ct`, `/ct/server`)

Graceful-degradation UI + probes for common commercetools project failure
modes, shared so each fix lands once.

- `getSessionSecret()` (`src/ct/server/session-secret.ts`) — HMAC key for a
  session JWT; refuses a public dev fallback in production (mandates
  `SESSION_SECRET`) so a deploy that forgot to set it can't be impersonated.
- `checkProjectActive()` / `isProjectExpired()` /
  `markProjectExpiredFromError()` (`src/ct/server/project-status.ts`) +
  `<ProjectExpiredBanner>` (`src/ct/ProjectExpiredBanner.tsx`) — throttled
  OAuth probe and error-classifier for an expired commercetools trial
  project, rendered as a banner in the app's root layout.
- `createProductSearchStatus()` (`src/ct/server/product-search.ts`) +
  `<ProductSearchDisabledBanner>` (`src/ct/ProductSearchDisabledBanner.tsx`)
  — throttled probe (default 30s TTL) and error-classifier for a project
  where Product Search can't be used yet, via a caller-supplied probe
  closure bound to the app's own client; surfaces a banner instead of a hard
  failure. `isProductSearchDisabledError()` (5.9.1) recognizes two distinct
  commercetools failure shapes as the same "not ready" condition: the API
  never activated (400, "Product Search API is not enabled") and a project
  whose index is still building after a fresh activation, which instead
  answers 404 `ResourceNotFound` with the misleading message `Project "<key>"
  does not exist` even though the project exists and every other call in the
  request succeeds — anchored on message text for the first shape and on
  status code + message pattern for the second, so it doesn't swallow an
  unrelated 404 (e.g. a genuinely missing product) that happens to share the
  `ResourceNotFound` code.
- `isCommercetoolsHostedImage` / `appendRenditionSuffix`
  (`src/ct/image-config.ts`) — helpers for commercetools-hosted product image
  URLs and requesting a specific rendition size.

## Demo tooling, testing & versioning

- No `tools/*` seed scripts in this repo — it is a library, not a demo with
  its own commercetools project/data.
- `test/route-types.ts` — compile-only type-check pinning the `Request`
  (not structural `RequestLike`) constraint Next's route validator requires.
- `test/money-fields.ts` — compile-only type-check for the money-field
  contract.
- `test/runtime/*.test.mjs` (run via `node --test`) — runtime regression
  tests: `builtin-tools.test.mjs`, `gate-copy.test.mjs`,
  `gate-grant.test.mjs`, `gate-preview.test.mjs`,
  `product-search-status.test.mjs`, `relevance.test.mjs`,
  `store-scoping.test.mjs`, `tool-source.test.mjs`, `track.test.mjs`,
  `tracker-scripts.test.mjs` — each pinning one of the hard-won bug fixes
  documented above (e.g. 4 of `track.test.mjs`'s 7 cases fail against the
  pre-5.7.2 shim; `tracker-scripts.test.mjs` pins the `defer`-not-`async`
  script tag; `product-search-status.test.mjs` pins the 404
  index-still-building shape observed on a freshly seeded project on
  2026-08-31, transcribed from the real commercetools response, alongside a
  case proving an unrelated `ResourceNotFound` 404 is not swallowed).
- `npm run verify` (`typecheck && build && test:runtime`) runs as
  `prepublishOnly`, so a broken build/type-check/runtime test blocks
  `npm publish`.
- Versioning is documented in `README.md` from `3.0.x` (JsonViewer/JsonModal
  only) through `5.3.x` (store scoping) with a `6.0.0` plan (`ChatProvider`/
  `useChat` context with generics, slot-based `<ChatPanel>`, pluggable
  `<ChatMessage>` artifact router) — those v6 pieces are **not yet
  implemented** in `src/`.
- Reference consumers integrating the package end-to-end: `b2b-starter` and
  `b2c-starter` (linked from `README.md`).
