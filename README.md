# @cboyke/demotools

Reusable React components and AI-chat scaffolding for building commercetools
demos.

## Modules

The package exports three subpaths:

| Import path                              | Contents                                       |
|------------------------------------------|------------------------------------------------|
| `@cboyke/demotools`                      | UI components (`JsonViewer`, `JsonModal`)      |
| `@cboyke/demotools/chat`                 | Chat types, `ChatActionChips`                  |
| `@cboyke/demotools/chat/server`          | Chat agent loop, route factory                 |

The `chat/server` entrypoint is server-only — keep it out of `'use client'`
files so the LLM driver doesn't end up in the browser bundle.

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
system-reminder injection, address-detection, set-cookie forwarding); the
demo owns its own tools, system prompt, and branding.

### Why share this layer

Roughly 70% of the chat code in our demos is identical: agent loop, voice
loop, Markdown rendering, action chips, OOS guard, ref-locked tile button.
Sharing it eliminates a real bug class — most recently a fix that landed in
b2b on 2026-05-02 and silently went un-ported to b2c for a day. With this
package, fixes flow through `npm version patch` and a `Renovate` bump.

### What the package does NOT include

Per-demo divergence stays per-demo:
- **Tool implementations** (`search_products`, `add_to_cart`, etc.) — they
  bind to each demo's commerce backend (B2B as-associate carts vs. B2C
  anonymous; BU/store pickers vs. payment forms).
- **System prompt** — tone, scope, branding.
- **Cart-touching components** (`ChatProductTile`, `ChatCartSummary`,
  `ChatAddressForm`, etc.) — they need a `useCart()` shim and a unified
  `formatMoney` signature first. Held back; planned for a later release.
- **`ChatProvider`/`useChat` context** — extending `UiAction` and artifact
  types via generics needs review before the API ossifies.
- **Voice loop hook** — pure utility, lifts as-is in a follow-up release.

### Quick wire-up (Next.js App Router)

```ts
// site/app/api/chat/route.ts
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

// Adapt your existing executeTool(name, args, ctx) to the library's
// `(args, ctx) => ToolExecutionResult` shape:
const toolRegistry = Object.fromEntries(
  TOOL_NAMES.map((name) => [
    name,
    async (args, ctx) => {
      const r = await executeTool(name, args, ctx as ToolContext);
      return {
        toolPayload: r.toolPayload,
        isError: r.isError,
        setCookies: r.setCookies,
        artifacts: { products: r.products, cart: r.cart, order: r.order, /* ... */ },
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
    ctx: { session, /* ... */ },
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

A `makeChatRoute(opts)` factory exists too — see
[`src/chat/server/route-factories.ts`](https://github.com/commercetools-demo/demotools/blob/main/src/chat/server/route-factories.ts)
— but the explicit form above maps more clearly to what each demo needs to
provide.

### Action chips

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

The UI components use Tailwind utility classes. If your project is on Tailwind
v4, add a `@source` line to your CSS so the classes get scanned in
`node_modules`:

```css
@import "tailwindcss";
@source "../node_modules/@cboyke/demotools/dist/**/*.js";
```

## Versioning

- `3.0.x` — `JsonViewer` + `JsonModal` only.
- `3.1.x` — adds `/chat` and `/chat/server` subpaths. Existing imports
  unchanged.
- `4.0.0` (planned) — adds chat React components (`ChatPanel`,
  `ChatLauncher`, `ChatMessage`, `ChatProductTile`, voice loop). Will
  require a `formatMoney` callback prop on cart-touching components, hence
  the major bump.
