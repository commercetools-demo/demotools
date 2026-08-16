/**
 * Next.js App Router route factories for /api/chat, /speak, /transcribe.
 *
 * Each demo's route file becomes a one-liner:
 *
 *   // site/app/api/chat/route.ts
 *   import { makeChatRoute } from '@cboyke/demotools/chat/server';
 *   import { tools, toolRegistry } from '@/lib/chat/tools';
 *   import { buildSystemPrompt } from '@/lib/chat/system-prompt';
 *   import { getSession } from '@/lib/session';
 *   import { openaiChatComplete } from '@/lib/chat/openai';
 *
 *   export const POST = makeChatRoute({
 *     getSession,
 *     buildSystemPrompt,
 *     tools, toolRegistry,
 *     chatComplete: openaiChatComplete,
 *   });
 *
 * The library doesn't ship with an OpenAI client because callers should pin
 * their own SDK version. A 5-line `openaiChatComplete` helper lives in each
 * consumer repo; we may publish a separate `@cboyke/demotools-openai` adapter
 * in v4 if it proves useful.
 */

import { runChatTurn, type ChatComplete } from '../agent.js';
import { type ToolSource } from './mcp-tools.js';
import {
  readChatToolSourceMode,
  resolveToolSources,
  type ChatToolSourceMode,
} from './tool-source.js';
import type {
  ChatTurnRequest,
  Tool,
  ToolRegistry,
  UiActionBase,
} from '../types.js';

// The handler's first argument is the global `Request` — see the long note in
// tracker/server/routes.ts. Next's route validator reads the DECLARED parameter
// type and requires it to extend `Request | NextRequest`, so a structural subset
// (`interface NextRequestLike { json(); headers; nextUrl }`) fails the build for
// anyone who re-exports the handler directly, even though `tsc --noEmit` passes.
// That is what broke b2c-starter's gate route; these factories had the same
// defect and only escaped it because their consumers happen to wrap the handler
// in a local function. Fixed 2026-08-10.
//
// `Request` is a global, so this still takes no dependency on `next` — which was
// the point of the subset. `nextUrl.origin` was the one member plain Request
// lacks; it is now derived from `request.url`, which App Router route handlers
// give as an absolute URL.

// NextResponse extends Response. We type the factory return as `Response`
// so consumers can re-export the handler directly without casting.
interface NextResponseFactory {
  json(body: unknown, init?: { status?: number }): Response;
}

/**
 * Per-request session (whatever the demo's session shape is — we don't care).
 * Demos hand us a getter; we don't try to be smart.
 */
export interface MakeChatRouteOptions<Session, UiAction = UiActionBase> {
  getSession: () => Promise<Session>;
  /**
   * Build the tool context the registry receives. Defaults to passing
   * `{ session, language, origin, cookieHeader }` which matches the b2b/b2c
   * convention.
   */
  buildToolContext?: (args: {
    session: Session;
    language: string;
    origin: string;
    cookieHeader: string;
  }) => unknown;
  buildSystemPrompt: (args: { session: Session; language: string }) => string;
  /** Local, session-bound tools. Optional when `toolSource` supplies everything. */
  tools?: Tool[];
  toolRegistry?: ToolRegistry<unknown>;
  /**
   * Remote tools resolved per request — typically
   * `createMcpToolSource(...).getToolSource` for a commercetools Managed MCP
   * Server. Resolved once per turn and merged with `tools`/`toolRegistry`,
   * which win on name collisions so a demo can shadow a remote tool locally.
   *
   * If the source throws (MCP server down, credentials rotated), the turn
   * still runs with the local tools only.
   */
  toolSource?: () => Promise<ToolSource<unknown>>;
  /** Called when `toolSource` fails, so the demo can log the degradation. */
  onToolSourceError?: (error: unknown) => void;
  /**
   * The built-in commerce tool pack, from
   * `createBuiltinToolSource` in `@cboyke/demotools/chat/tools`.
   *
   * Included when the tool-source mode is `builtin` (the default) or `both`, and
   * shadowed by `tools`/`toolRegistry` on name collisions.
   */
  builtinToolSource?: ToolSource<unknown>;
  /**
   * Which tool sources to use. Defaults to reading
   * `DEMOTOOLS_CHAT_TOOL_SOURCE` from the environment, which itself defaults to
   * `builtin` — so MCP stays off unless a demo asks for it.
   *
   * Pass a literal to bypass the environment entirely (useful in tests).
   */
  toolSourceMode?: ChatToolSourceMode;
  chatComplete: ChatComplete;
  /** Optional rate limit per session/IP. Default 20/min. Pass null to disable. */
  rateLimit?: { limit: number; windowMs: number } | null;
  /** Override default formatUiAction. */
  formatUiAction?: (action: UiAction) => string;
  /** Optional model override; falls back to env CHAT_MODEL → driver default. */
  model?: string;
  /**
   * The Next.js NextResponse-shaped factory. Pass `NextResponse` from
   * `next/server`. We accept it as a parameter to avoid a peer dep on `next`.
   */
  NextResponse: NextResponseFactory;
}

const rateLimits = new Map<string, { count: number; resetAt: number }>();

function rateOk(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || entry.resetAt < now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

/**
 * Build a POST handler for `/api/chat`.
 *
 * Returns a function compatible with Next.js App Router route signatures.
 */
export function makeChatRoute<Session, UiAction = UiActionBase>(
  opts: MakeChatRouteOptions<Session, UiAction>,
): (request: Request) => Promise<Response> {
  const rate = opts.rateLimit === undefined ? { limit: 20, windowMs: 60_000 } : opts.rateLimit;

  return async function POST(request) {
    try {
      const session = await opts.getSession();
      const body = (await request.json()) as ChatTurnRequest<UiAction> | undefined;
      const messages = body?.messages ?? [];
      const uiActions = body?.uiActions ?? [];
      const recentProducts = body?.recentProducts ?? [];
      const language =
        body?.language ?? (session as { locale?: string } | null)?.locale ?? 'en-US';

      if (rate) {
        const rateKey =
          (session as { customerId?: string } | null)?.customerId ??
          request.headers.get('x-forwarded-for') ??
          request.headers.get('x-real-ip') ??
          'anon';
        if (!rateOk(rateKey, rate.limit, rate.windowMs)) {
          return opts.NextResponse.json(
            { error: 'Too many requests. Please try again in a minute.' },
            { status: 429 },
          );
        }
      }

      if (!Array.isArray(messages) || messages.length === 0) {
        return opts.NextResponse.json({ error: 'messages required' }, { status: 400 });
      }

      const cookieHeader = request.headers.get('cookie') ?? '';
      const origin = new URL(request.url).origin;
      const ctx = opts.buildToolContext
        ? opts.buildToolContext({ session, language, origin, cookieHeader })
        : { session, language, origin, cookieHeader };

      const systemPrompt = opts.buildSystemPrompt({ session, language });

      // Precedence, lowest to highest: MCP → built-in pack → this demo's own
      // tools. A remote source is an enhancement, not a hard dependency: if it
      // throws, the turn still runs on whatever remains.
      const { tools, toolRegistry } = await resolveToolSources<unknown>({
        mode: opts.toolSourceMode ?? readChatToolSourceMode(),
        mcp: opts.toolSource,
        builtin: opts.builtinToolSource,
        local: {
          tools: opts.tools ?? [],
          toolRegistry: opts.toolRegistry ?? {},
        },
        onMcpError: opts.onToolSourceError,
      });

      const { setCookies, ...rest } = await runChatTurn({
        messages,
        uiActions,
        recentProducts,
        language,
        ctx,
        systemPrompt,
        tools,
        toolRegistry,
        chatComplete: opts.chatComplete,
        formatUiAction: opts.formatUiAction as never,
        model: opts.model,
      });

      const response = opts.NextResponse.json(rest);
      for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
      return response;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Chat error';
      console.error('[chat] error:', msg);
      return opts.NextResponse.json({ error: msg }, { status: 500 });
    }
  };
}

// makeSpeakRoute / makeTranscribeRoute moved to ./audio-routes.ts
