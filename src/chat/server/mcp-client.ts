/**
 * Minimal MCP client for commercetools Managed MCP Servers.
 *
 * Speaks the Streamable HTTP transport directly (JSON-RPC 2.0 over POST) so
 * the library takes no dependency on `@modelcontextprotocol/sdk`. Demos run on
 * serverless Node — one small file beats pulling in a transport stack that
 * assumes a long-lived process.
 *
 * What it handles that a naive `fetch` does not:
 *   - `initialize` → `notifications/initialized` handshake, done lazily once
 *     and shared across concurrent callers.
 *   - Responses that come back as either `application/json` or an SSE stream
 *     (`text/event-stream`); Managed MCP Servers use both depending on method.
 *   - `Mcp-Session-Id` capture and replay, including re-initialising when the
 *     server drops the session (HTTP 404 on a live session).
 *   - OAuth2 client-credentials token caching + refresh on 401.
 */

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface McpCallResult {
  content: McpContentBlock[];
  isError?: boolean;
  structuredContent?: unknown;
}

export type McpAuth =
  | { type: 'bearer'; token: string | (() => string | Promise<string>) }
  | {
      type: 'clientCredentials';
      /** e.g. https://auth.us-central1.gcp.commercetools.com */
      authUrl: string;
      clientId: string;
      clientSecret: string;
      /** e.g. mcp:my-project:my-server */
      scope?: string;
    };

export interface McpClientOptions {
  /** Managed MCP Server URL, from `mcpServer.url` on the MCP Server config. */
  url: string;
  auth: McpAuth;
  clientInfo?: { name: string; version: string };
  protocolVersion?: string;
  /** Per-request timeout in ms. Default 20_000. */
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 20_000;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpError extends Error {
  readonly code?: number;
  readonly data?: unknown;
  constructor(message: string, opts: { code?: number; data?: unknown } = {}) {
    super(message);
    this.name = 'McpError';
    this.code = opts.code;
    this.data = opts.data;
  }
}

/** Thrown when the transport fails, as opposed to the tool returning isError. */
export class McpTransportError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'McpTransportError';
    this.status = status;
  }
}

export class McpClient {
  private readonly url: string;
  private readonly auth: McpAuth;
  private readonly clientInfo: { name: string; version: string };
  private readonly protocolVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  private nextId = 0;
  private sessionId: string | undefined;
  /** In-flight or completed handshake; shared so concurrent calls initialise once. */
  private handshake: Promise<void> | undefined;
  private cachedToken: { value: string; expiresAt: number } | undefined;

  constructor(opts: McpClientOptions) {
    this.url = opts.url;
    this.auth = opts.auth;
    this.clientInfo = opts.clientInfo ?? { name: '@cboyke/demotools', version: '4' };
    this.protocolVersion = opts.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('No fetch implementation available — pass fetchImpl.');
    }
  }

  // ---------------------------------------------------------------- auth ---

  private async token(forceRefresh = false): Promise<string> {
    if (this.auth.type === 'bearer') {
      const t = this.auth.token;
      return typeof t === 'function' ? await t() : t;
    }

    const now = Date.now();
    if (!forceRefresh && this.cachedToken && this.cachedToken.expiresAt > now) {
      return this.cachedToken.value;
    }

    const { authUrl, clientId, clientSecret, scope } = this.auth;
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (scope) body.set('scope', scope);

    const basic = base64(`${clientId}:${clientSecret}`);

    const res = await this.fetchImpl(`${authUrl.replace(/\/$/, '')}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new McpTransportError(
        `MCP token request failed (${res.status}): ${text.slice(0, 300)}`,
        res.status,
      );
    }

    const json = (await res.json()) as { access_token: string; expires_in?: number };
    // Refresh a minute early so a token never expires mid-turn.
    const ttl = Math.max(30, (json.expires_in ?? 3600) - 60) * 1000;
    this.cachedToken = { value: json.access_token, expiresAt: Date.now() + ttl };
    return json.access_token;
  }

  // ----------------------------------------------------------- transport ---

  private async post(
    payload: unknown,
    token: string,
  ): Promise<{ status: number; sessionId: string | null; body: JsonRpcResponse | undefined }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          // Managed MCP Servers answer some methods as SSE, some as plain JSON.
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': this.protocolVersion,
          ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        throw new McpTransportError(`MCP request timed out after ${this.timeoutMs}ms`);
      }
      throw new McpTransportError(`MCP request failed: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      clearTimeout(timer);
    }

    const sessionId = res.headers.get('mcp-session-id');
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();

    if (!text) return { status: res.status, sessionId, body: undefined };

    let body: JsonRpcResponse | undefined;
    if (contentType.includes('text/event-stream')) {
      body = parseSseEnvelope(text);
    } else {
      try {
        body = JSON.parse(text) as JsonRpcResponse;
      } catch {
        // Non-JSON error bodies (HTML gateway pages, plain text) land here.
        if (!res.ok) {
          throw new McpTransportError(
            `MCP server returned ${res.status}: ${text.slice(0, 300)}`,
            res.status,
          );
        }
        throw new McpTransportError(`MCP server returned unparseable body: ${text.slice(0, 300)}`);
      }
    }

    return { status: res.status, sessionId, body };
  }

  /**
   * One JSON-RPC request/response round trip with the retry rules that matter
   * in practice: refresh the token once on 401, re-handshake once on a dropped
   * session.
   */
  private async rpc(method: string, params: unknown, isRetry = false): Promise<unknown> {
    if (method !== 'initialize') await this.ensureInitialized();

    const token = await this.token();
    const id = ++this.nextId;
    const { status, sessionId, body } = await this.post(
      { jsonrpc: '2.0', id, method, params },
      token,
    );

    if (sessionId) this.sessionId = sessionId;

    if (status === 401 && !isRetry) {
      await this.token(true);
      return this.rpc(method, params, true);
    }

    // The server forgot our session — drop it and redo the handshake once.
    if ((status === 404 || status === 400) && this.sessionId && !isRetry) {
      this.sessionId = undefined;
      this.handshake = undefined;
      return this.rpc(method, params, true);
    }

    if (status >= 400 && !body?.error) {
      throw new McpTransportError(`MCP ${method} failed with HTTP ${status}`, status);
    }
    if (body?.error) {
      throw new McpError(`MCP ${method} error: ${body.error.message}`, {
        code: body.error.code,
        data: body.error.data,
      });
    }
    if (!body) throw new McpTransportError(`MCP ${method} returned an empty body`);

    return body.result;
  }

  private ensureInitialized(): Promise<void> {
    if (!this.handshake) {
      this.handshake = this.doHandshake().catch((e) => {
        // Don't cache a failed handshake — the next call should retry.
        this.handshake = undefined;
        throw e;
      });
    }
    return this.handshake;
  }

  private async doHandshake(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: this.clientInfo,
    });

    // Per spec this notification has no id and expects no response body.
    const token = await this.token();
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, token).catch(() => {
      // Some servers close the stream immediately; a failure here is not fatal.
    });
  }

  // -------------------------------------------------------------- public ---

  async listTools(): Promise<McpToolDefinition[]> {
    const all: McpToolDefinition[] = [];
    let cursor: string | undefined;
    do {
      const result = (await this.rpc('tools/list', cursor ? { cursor } : {})) as {
        tools?: McpToolDefinition[];
        nextCursor?: string;
      };
      all.push(...(result?.tools ?? []));
      cursor = result?.nextCursor;
    } while (cursor);
    return all;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const result = (await this.rpc('tools/call', { name, arguments: args })) as McpCallResult;
    return {
      content: result?.content ?? [],
      isError: result?.isError,
      structuredContent: result?.structuredContent,
    };
  }

  /** Drop the session so the next call re-handshakes. */
  reset(): void {
    this.sessionId = undefined;
    this.handshake = undefined;
  }
}

/**
 * Base64 for the Basic auth header. API Client ids and secrets are ASCII, so
 * `btoa` is safe; Node's `Buffer` is used as a fallback without pulling in
 * @types/node.
 */
function base64(input: string): string {
  const g = globalThis as unknown as {
    btoa?: (s: string) => string;
    Buffer?: { from(s: string, enc: string): { toString(enc: string): string } };
  };
  if (typeof g.btoa === 'function') return g.btoa(input);
  if (g.Buffer) return g.Buffer.from(input, 'utf8').toString('base64');
  throw new Error('No base64 encoder available (neither btoa nor Buffer).');
}

/**
 * Pull the JSON-RPC envelope out of an SSE body.
 *
 * A Streamable HTTP response may interleave notifications with the actual
 * response, so take the last frame that carries a `result` or `error`.
 */
function parseSseEnvelope(text: string): JsonRpcResponse | undefined {
  let found: JsonRpcResponse | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.startsWith('data:')) continue;
    const data = rawLine.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data) as JsonRpcResponse;
      if (parsed && (parsed.result !== undefined || parsed.error !== undefined)) found = parsed;
    } catch {
      // Ignore keep-alive / partial frames.
    }
  }
  return found;
}

/**
 * Concatenate the text blocks of a tool result and JSON.parse them when
 * possible. Commerce MCP returns a single text block holding the raw
 * commercetools JSON payload.
 */
export function decodeMcpResult(result: McpCallResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('');
  if (!text) return result.content;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
