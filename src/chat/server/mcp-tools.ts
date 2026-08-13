/**
 * Turn a commercetools Managed MCP Server into a drop-in tool source for the
 * agent loop.
 *
 * The agent loop speaks OpenAI's function-call shape; MCP speaks JSON-RPC with
 * JSON Schema. This module bridges the two and adds the three things a demo
 * always ends up needing:
 *
 *   1. **Argument injection** — the session decides currency, locale, store and
 *      (critically) *which cart* may be read. Those are forced server-side, not
 *      left to the model, so a shopper's assistant cannot be talked into
 *      reading someone else's cart with a project-wide MCP credential.
 *   2. **Result mapping** — MCP hands back raw commercetools JSON. The chat UI
 *      renders typed artifacts (product tiles, cart cards). The mapper turns
 *      one into the other, and can also shrink what goes back to the model.
 *   3. **Schema flattening** — Commerce MCP schemas use internal `$ref`
 *      pointers, which several LLM function-calling endpoints reject.
 */

import type { Tool, ToolExecutionResult, ToolHandler, ToolRegistry } from '../types.js';
import {
  McpClient,
  McpError,
  McpTransportError,
  decodeMcpResult,
  type McpCallResult,
  type McpClientOptions,
  type McpToolDefinition,
} from './mcp-client.js';

export interface ToolSource<Ctx = unknown, Extra = Record<string, unknown>> {
  tools: Tool[];
  toolRegistry: ToolRegistry<Ctx, Extra>;
}

export interface McpToolSourceOptions<Ctx = unknown, Extra = Record<string, unknown>>
  extends McpClientOptions {
  /** Expose only these MCP tools. Applied before `exclude` and `rename`. */
  include?: string[];
  /** Hide these MCP tools even if the server offers them. */
  exclude?: string[];
  /** MCP tool name → the name the model sees. Handlers accept both. */
  rename?: Record<string, string>;
  /**
   * Replace a tool's description. Commerce MCP ships long, generic
   * descriptions; a demo-specific one costs fewer tokens and aims the model at
   * the right tool. Prefer doing this centrally with `toolCustomizations` on
   * the MCP Server itself — this is the local escape hatch.
   */
  describe?: Record<string, string>;
  /**
   * Trim a tool's parameter schema before the model sees it.
   *
   * This matters more than it sounds. `read_product_search` alone ships a
   * ~28 KB JSON Schema (the recursive compound-query expression), and the full
   * eight-tool catalogue costs ~12k tokens *per agent-loop iteration*. Pruning
   * to the parameters a storefront assistant actually sets cuts that by an
   * order of magnitude. Anything injected via `injectArgs` should be omitted
   * here — the model has no business setting it.
   */
  params?: Record<string, { pick?: string[]; omit?: string[] }>;
  /**
   * How deep to expand `$ref` pointers before collapsing to a permissive
   * object. Lower is cheaper. Default 8; 3 is usually plenty for search
   * queries.
   */
  maxSchemaDepth?: number;
  /** Truncate descriptions to this many characters. Off by default. */
  maxDescriptionChars?: number;
  /**
   * Force or default arguments per call. Returned keys overwrite whatever the
   * model supplied, so use it for session-derived values.
   */
  injectArgs?: (
    toolName: string,
    args: Record<string, unknown>,
    ctx: Ctx,
  ) => Record<string, unknown> | undefined;
  /**
   * Answer a call locally instead of hitting the MCP server. Return a result to
   * short-circuit, or nothing to proceed.
   *
   * Needed whenever the session makes a remote call pointless or unsafe: a
   * guest with no cart yet, an order lookup from a signed-out visitor. Without
   * it those turn into avoidable 404s that the model then has to interpret.
   */
  preflight?: (
    toolName: string,
    args: Record<string, unknown>,
    ctx: Ctx,
  ) => ToolExecutionResult<Extra> | undefined | void;
  /**
   * Post-process a decoded tool result. Return `toolPayload` to replace what
   * the model sees, and/or `artifacts` to drive the UI. Return nothing to pass
   * the raw payload straight through.
   */
  mapResult?: (
    toolName: string,
    payload: unknown,
    ctx: Ctx,
  ) => Partial<ToolExecutionResult<Extra>> | undefined | void;
  /** How long to reuse a `tools/list` response, in ms. Default 5 minutes. */
  toolsCacheMs?: number;
  /** Called for transport/tool failures so demos can log without crashing a turn. */
  onError?: (error: unknown, info: { phase: 'list' | 'call'; tool?: string }) => void;
}

const DEFAULT_TOOLS_CACHE_MS = 5 * 60_000;

/**
 * Inline internal `$ref` pointers so the schema is self-contained.
 *
 * Commerce MCP emits refs like `#/properties/query/properties/fullText`, and
 * the recursive ones (a compound `and` whose items point back at the query
 * schema) would expand forever — those collapse to a permissive object.
 */
export function inlineJsonSchemaRefs(schema: unknown, maxDepth = 8): unknown {
  const root = schema;

  const resolvePointer = (pointer: string): unknown => {
    if (!pointer.startsWith('#')) return undefined;
    const parts = pointer
      .slice(1)
      .split('/')
      .filter(Boolean)
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    let node: unknown = root;
    for (const part of parts) {
      if (node && typeof node === 'object') {
        node = (node as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return node;
  };

  const walk = (node: unknown, seen: Set<string>, depth: number): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, seen, depth + 1));
    if (!node || typeof node !== 'object') return node;

    const obj = node as Record<string, unknown>;
    const ref = obj.$ref;

    if (typeof ref === 'string') {
      // Cycle, or nested too deep to be worth expanding.
      if (seen.has(ref) || depth > maxDepth) return { type: 'object', additionalProperties: true };
      const target = resolvePointer(ref);
      if (target === undefined) return { type: 'object', additionalProperties: true };
      const { $ref: _drop, ...siblings } = obj;
      const expanded = walk(target, new Set([...seen, ref]), depth + 1);
      return { ...(expanded as Record<string, unknown>), ...siblings };
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$schema') continue;
      out[k] = walk(v, seen, depth + 1);
    }
    return out;
  };

  return walk(root, new Set(), 0);
}

/** Convert one MCP tool definition to the OpenAI function-tool shape. */
export function mcpToolToFunctionTool(
  def: McpToolDefinition,
  opts: {
    name?: string;
    description?: string;
    pick?: string[];
    omit?: string[];
    maxDepth?: number;
    maxDescriptionChars?: number;
  } = {},
): Tool {
  const schema = (inlineJsonSchemaRefs(def.inputSchema ?? {}, opts.maxDepth) ?? {}) as Record<
    string,
    unknown
  >;
  // Some servers omit `type` on the root schema; OpenAI requires it.
  if (!schema.type) schema.type = 'object';
  if (!schema.properties) schema.properties = {};

  if (opts.pick || opts.omit) {
    const props = schema.properties as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (opts.pick && !opts.pick.includes(key)) continue;
      if (opts.omit?.includes(key)) continue;
      kept[key] = value;
    }
    schema.properties = kept;
    // Never leave a `required` entry pointing at a parameter we just removed.
    if (Array.isArray(schema.required)) {
      const required = (schema.required as string[]).filter((r) => r in kept);
      if (required.length > 0) schema.required = required;
      else delete schema.required;
    }
  }

  let description = (opts.description ?? def.description ?? def.name).trim();
  if (opts.maxDescriptionChars && description.length > opts.maxDescriptionChars) {
    description = `${description.slice(0, opts.maxDescriptionChars).trimEnd()}…`;
  }

  return {
    type: 'function',
    function: { name: opts.name ?? def.name, description, parameters: schema },
  };
}

/**
 * Connect to a Managed MCP Server, list its tools, and return them as a tool
 * source the agent loop can consume directly.
 *
 * The `tools/list` result is cached per source instance, so a warm serverless
 * container pays the handshake once rather than once per chat turn.
 */
export function createMcpToolSource<Ctx = unknown, Extra = Record<string, unknown>>(
  opts: McpToolSourceOptions<Ctx, Extra>,
): {
  getToolSource: () => Promise<ToolSource<Ctx, Extra>>;
  client: McpClient;
  refresh: () => void;
} {
  const client = new McpClient(opts);
  const cacheMs = opts.toolsCacheMs ?? DEFAULT_TOOLS_CACHE_MS;
  const rename = opts.rename ?? {};
  // Model-facing name → real MCP tool name.
  const reverseRename = new Map(Object.entries(rename).map(([mcp, exposed]) => [exposed, mcp]));

  let cache: { at: number; source: ToolSource<Ctx, Extra> } | undefined;
  let inFlight: Promise<ToolSource<Ctx, Extra>> | undefined;

  const makeHandler = (mcpName: string): ToolHandler<Ctx, Extra> => {
    return async (args, ctx) => {
      const base = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;

      const shortCircuit = opts.preflight?.(mcpName, base, ctx);
      if (shortCircuit) return shortCircuit;

      const injected = opts.injectArgs?.(mcpName, base, ctx) ?? {};
      const finalArgs = { ...base, ...injected };

      let raw: McpCallResult;
      try {
        raw = await client.callTool(mcpName, finalArgs);
      } catch (e) {
        opts.onError?.(e, { phase: 'call', tool: mcpName });
        const message =
          e instanceof McpError || e instanceof McpTransportError
            ? e.message
            : `MCP tool ${mcpName} failed`;
        // Hand the model a readable error instead of blowing up the turn.
        return { toolPayload: { error: message }, isError: true };
      }

      const payload = decodeMcpResult(raw);

      if (raw.isError) {
        opts.onError?.(new McpError(`Tool ${mcpName} reported an error`, { data: payload }), {
          phase: 'call',
          tool: mcpName,
        });
        return { toolPayload: payload, isError: true };
      }

      const mapped = opts.mapResult?.(mcpName, payload, ctx);
      if (!mapped) return { toolPayload: payload };

      return {
        toolPayload: 'toolPayload' in mapped ? mapped.toolPayload : payload,
        isError: mapped.isError,
        setCookies: mapped.setCookies,
        artifacts: mapped.artifacts,
      };
    };
  };

  async function build(): Promise<ToolSource<Ctx, Extra>> {
    const defs = await client.listTools();

    const tools: Tool[] = [];
    const toolRegistry: ToolRegistry<Ctx, Extra> = {};

    for (const def of defs) {
      if (opts.include && !opts.include.includes(def.name)) continue;
      if (opts.exclude?.includes(def.name)) continue;

      const exposedName = rename[def.name] ?? def.name;
      tools.push(
        mcpToolToFunctionTool(def, {
          name: exposedName,
          description: opts.describe?.[def.name],
          pick: opts.params?.[def.name]?.pick,
          omit: opts.params?.[def.name]?.omit,
          maxDepth: opts.maxSchemaDepth,
          maxDescriptionChars: opts.maxDescriptionChars,
        }),
      );

      const handler = makeHandler(def.name);
      toolRegistry[exposedName] = handler;
      // Models occasionally emit the underlying name when a rename is in play.
      if (exposedName !== def.name && !toolRegistry[def.name]) {
        toolRegistry[def.name] = handler;
      }
    }

    // Renames pointing at tools the server didn't offer are a config typo.
    for (const [mcpName, exposed] of reverseRename) {
      if (!toolRegistry[mcpName]) continue;
      void exposed;
    }

    return { tools, toolRegistry };
  }

  async function getToolSource(): Promise<ToolSource<Ctx, Extra>> {
    if (cache && Date.now() - cache.at < cacheMs) return cache.source;
    if (inFlight) return inFlight;

    inFlight = build()
      .then((source) => {
        cache = { at: Date.now(), source };
        return source;
      })
      .catch((e) => {
        opts.onError?.(e, { phase: 'list' });
        // Serve a stale list rather than losing every MCP tool for the turn.
        if (cache) return cache.source;
        throw e;
      })
      .finally(() => {
        inFlight = undefined;
      });

    return inFlight;
  }

  return {
    getToolSource,
    client,
    refresh: () => {
      cache = undefined;
      client.reset();
    },
  };
}

/**
 * Merge tool sources into one. Later sources win on name collisions, so pass
 * local/session-bound tools last when they must shadow an MCP tool.
 */
export function mergeToolSources<Ctx = unknown, Extra = Record<string, unknown>>(
  ...sources: Array<ToolSource<Ctx, Extra> | undefined>
): ToolSource<Ctx, Extra> {
  const byName = new Map<string, Tool>();
  const toolRegistry: ToolRegistry<Ctx, Extra> = {};

  for (const source of sources) {
    if (!source) continue;
    for (const tool of source.tools) byName.set(tool.function.name, tool);
    Object.assign(toolRegistry, source.toolRegistry);
  }

  return { tools: [...byName.values()], toolRegistry };
}
