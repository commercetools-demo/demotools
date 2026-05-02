# `@cboyke/demotools/chat` — design notes

## Why this exists

Today's `b2b-starter` and `b2c-starter` share roughly **70% of their chat
assistant code verbatim** (agent loop, voice loop, Markdown rendering, action
chips, OOS guard, ref-locked tile button, "Continue chat" pill, address
detection, voice toggles, etc.). The remaining 30% — tool implementations,
system-prompt tone, branding — diverges for legitimate reasons.

The bug back-port that triggered this PR is the canonical example of why
copy-paste hurts: a fix landed in b2b on 2026-05-02, b2c silently kept the
broken version for a day before someone noticed.

## What's shared, what isn't

| Layer | Shared? | Why |
|---|---|---|
| Agent loop, system-reminder injection | ✅ | Identical in both |
| OpenAI driver | ❌ | Caller pins SDK version; library accepts a `chatComplete: ChatComplete` function |
| Tool definitions (search, cart, etc.) | ❌ | Each demo's tools bind to its commerce backend (B2B as-associate vs. B2C anonymous; BU/store pickers vs. payment forms) |
| Tool-runtime types (`Tool`, `ToolHandler`, `ToolExecutionResult`) | ✅ | Shape contract; demos provide implementations |
| System prompt | ❌ | Demo-specific tone, scope, branding |
| `detectAddressRequest` regex | ✅ | Library default; overridable |
| Voice loop hook | ✅ (next iteration) | Pure utility |
| `ChatActionChips`, presentational components | ✅ | Truly identical |
| `ChatProductTile`, cart-touching components | 🟡 | Need a `useCart()` shim — held back |
| Route factories | ✅ | One-line consumer wiring |
| Greeting copy, panel title, accent colors | ❌ | Pass via props |

## Public surface in this PR

```ts
// Client: types + components
import {
  type Tool, type ToolHandler, type ToolRegistry,
  type ChatTurnRequest, type ChatTurnResponse,
  type ProductSummary, type CartSummary, type OrderSummary,
  type ActionSuggestion, type UiActionBase,
  ChatActionChips,
} from '@cboyke/demotools/chat';

// Server: agent + route factories
import {
  runChatTurn,
  makeChatRoute,
  type ChatComplete,
} from '@cboyke/demotools/chat/server';
```

## What's a one-liner for consumers

```ts
// site/app/api/chat/route.ts
import OpenAI from 'openai';
import { makeChatRoute } from '@cboyke/demotools/chat/server';
import { NextResponse } from 'next/server';
import { tools, toolRegistry } from '@/lib/chat/tools';
import { buildSystemPrompt } from '@/lib/chat/system-prompt';
import { getSession } from '@/lib/session';

const openai = new OpenAI();

const chatComplete = async ({ messages, tools, model }) => {
  const response = await openai.chat.completions.create({
    model: model ?? process.env.CHAT_MODEL ?? 'gpt-4o-mini',
    tools,
    messages,
  });
  const choice = response.choices[0];
  return {
    finish_reason: choice.finish_reason,
    message: choice.message,
  };
};

export const POST = makeChatRoute({
  getSession,
  buildSystemPrompt: ({ session, language }) =>
    buildSystemPrompt({ language, isLoggedIn: !!session.customerId, /* ... */ }),
  tools,
  toolRegistry,
  chatComplete,
  NextResponse,
});
```

That's the entire `route.ts`. The demo's actual logic is in `tools.ts` +
`system-prompt.ts`.

## What's intentionally NOT in this PR

- **`ChatProvider` / `useChat` context** — needs more thought on the generic
  shape so demos can extend `UiAction` and artifact types without `as any`.
  Sketch in code review.
- **Cart-touching components** (`ChatProductTile`, `ChatCartSummary`, etc.) —
  need a unified `formatMoney` signature first. b2b takes `(money: Money)`,
  b2c takes `(centAmount, currency)`. Easier to fix in the demos than in
  the lib.
- **`makeSpeakRoute` / `makeTranscribeRoute`** — sketched as stubs. Trivial
  wrappers; will land once chat route is wired in at least one consumer.
- **Voice loop hook** — pure utility, lifts as-is. Coming in PR #2.

## Testing strategy

Smoke test the route factory by running the b2b chat-checkout Playwright
spec against b2b-starter wired up with `@cboyke/demotools/chat/server`. If
two BUs (Eagle, Liberty) still complete checkout end-to-end, the agent loop
factoring is correct. b2c's existing checkout flow gives us a second
consumer.

## Migration plan (when this PR lands)

1. Merge + publish `@cboyke/demotools@4.0.0-rc.0`.
2. b2b-starter PR: replace `site/lib/chat/agent.ts` and
   `site/app/api/chat/route.ts` with library imports. Smoke test with the
   chat-checkout spec.
3. Same for b2c-starter.
4. Cut `4.0.0` once both consumers are green for a week.
5. Repeat for the cart-touching components in a follow-up.
