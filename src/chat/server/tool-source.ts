/**
 * The tool-source feature flag.
 *
 * A demo's chat tools can come from two places, and which one is better is a
 * per-catalog empirical question rather than a settled architectural one:
 *
 *   - **builtin** — the hand-written pack in `../tools`. Owns the boosted
 *     relevance expression, so free-text catalog search actually works.
 *   - **mcp** — a commercetools Managed MCP Server, discovered at runtime.
 *     Central config, no per-demo tool code, but generic read tools whose
 *     relevance has to be rebuilt client-side to compete.
 *
 * This module makes that choice an environment variable instead of a code
 * change, so flipping it is a redeploy rather than a refactor — and so a demo
 * can be flipped back mid-conversation with a customer watching.
 *
 *   DEMOTOOLS_CHAT_TOOL_SOURCE=builtin   # default — MCP off
 *   DEMOTOOLS_CHAT_TOOL_SOURCE=mcp       # MCP only
 *   DEMOTOOLS_CHAT_TOOL_SOURCE=both      # merge; builtin wins on name collision
 *
 * Unset, empty or unrecognised values resolve to `builtin`. That default is
 * deliberate: an unparseable flag must not silently turn on a remote dependency.
 */

import type { ToolSource } from './mcp-tools.js';
import { mergeToolSources } from './mcp-tools.js';

export type ChatToolSourceMode = 'builtin' | 'mcp' | 'both';

/** The environment variable read by `readChatToolSourceMode`. */
export const CHAT_TOOL_SOURCE_ENV = 'DEMOTOOLS_CHAT_TOOL_SOURCE';

export const DEFAULT_CHAT_TOOL_SOURCE: ChatToolSourceMode = 'builtin';

/**
 * Parse a tool-source mode. Case- and whitespace-insensitive; a few obvious
 * aliases are accepted because this gets typed into Netlify's env UI by hand.
 */
export function parseChatToolSourceMode(raw: unknown): ChatToolSourceMode {
  if (typeof raw !== 'string') return DEFAULT_CHAT_TOOL_SOURCE;

  switch (raw.trim().toLowerCase()) {
    case 'mcp':
    case 'remote':
      return 'mcp';
    case 'both':
    case 'merge':
    case 'all':
      return 'both';
    case 'builtin':
    case 'built-in':
    case 'local':
    case '':
      return 'builtin';
    default:
      return DEFAULT_CHAT_TOOL_SOURCE;
  }
}

/**
 * Read the mode from the environment.
 *
 * `env` is injectable so this is testable and so a Next.js app can pass an
 * explicitly-inlined value — `process.env` is not enumerable at runtime in some
 * bundling modes, and a bare `process.env[NAME]` dynamic lookup can come back
 * undefined even when the variable is set.
 */
export function readChatToolSourceMode(
  env: Record<string, string | undefined> = typeof process !== 'undefined'
    ? process.env
    : {},
): ChatToolSourceMode {
  return parseChatToolSourceMode(env[CHAT_TOOL_SOURCE_ENV]);
}

/** True when the current mode consults the MCP server at all. */
export function isMcpEnabled(mode: ChatToolSourceMode): boolean {
  return mode === 'mcp' || mode === 'both';
}

/** True when the current mode includes the built-in pack. */
export function isBuiltinEnabled(mode: ChatToolSourceMode): boolean {
  return mode === 'builtin' || mode === 'both';
}

export interface ResolveToolSourcesInput<Ctx = unknown, Extra = Record<string, unknown>> {
  mode: ChatToolSourceMode;
  /** The built-in pack, from `createBuiltinToolSource`. */
  builtin?: ToolSource<Ctx, Extra>;
  /** Resolved per request — `createMcpToolSource(...).getToolSource`. */
  mcp?: () => Promise<ToolSource<Ctx, Extra>>;
  /** App-supplied tools. Always included, and always win. */
  local?: ToolSource<Ctx, Extra>;
  /** Called when the MCP source rejects, so the demo can log the degradation. */
  onMcpError?: (error: unknown) => void;
}

/**
 * Merge the enabled sources into the single `{tools, toolRegistry}` pair
 * `runChatTurn` wants.
 *
 * Precedence, lowest to highest: **mcp → builtin → local**. `mergeToolSources`
 * is last-wins, so passing them in that order means an app's own tool shadows
 * the built-in pack, and the built-in pack shadows a same-named MCP tool. That
 * ordering is the whole reason a demo can adopt the pack and still override one
 * tool it cares about.
 *
 * A failing MCP source degrades to the remaining sources rather than failing the
 * turn — the same rule `makeChatRoute` already applied to `toolSource`.
 */
export async function resolveToolSources<Ctx = unknown, Extra = Record<string, unknown>>(
  input: ResolveToolSourcesInput<Ctx, Extra>,
): Promise<ToolSource<Ctx, Extra>> {
  const { mode, builtin, mcp, local, onMcpError } = input;

  let remote: ToolSource<Ctx, Extra> | undefined;
  if (mcp && isMcpEnabled(mode)) {
    try {
      remote = await mcp();
    } catch (e) {
      onMcpError?.(e);
      console.error('[chat] MCP tool source unavailable:', (e as Error)?.message ?? e);
    }
  }

  return mergeToolSources<Ctx, Extra>(
    remote,
    isBuiltinEnabled(mode) ? builtin : undefined,
    local,
  );
}
