// Runtime regression tests for the builtin-vs-MCP feature flag.
//
// Two properties matter here and neither is type-checkable:
//
//   1. **MCP is off unless explicitly asked for.** Unset, empty, or unparseable
//      values must resolve to `builtin`. A flag typo must not silently turn on a
//      remote dependency mid-demo.
//   2. **Precedence is mcp → builtin → local.** `mergeToolSources` is last-wins,
//      so the argument order in `resolveToolSources` is the whole contract that
//      lets an app override one tool of the built-in pack. Swap two arguments and
//      everything still compiles, but a demo's own `search_products` silently
//      stops being used.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAT_TOOL_SOURCE_ENV,
  DEFAULT_CHAT_TOOL_SOURCE,
  isBuiltinEnabled,
  isMcpEnabled,
  parseChatToolSourceMode,
  readChatToolSourceMode,
  resolveToolSources,
} from '../../dist/chat/server/tool-source.js';

const source = (name, marker) => ({
  tools: [{ type: 'function', function: { name, description: marker, parameters: {} } }],
  toolRegistry: { [name]: async () => ({ toolPayload: marker }) },
});

test('the default is builtin — MCP stays off', () => {
  assert.equal(DEFAULT_CHAT_TOOL_SOURCE, 'builtin');
  assert.equal(readChatToolSourceMode({}), 'builtin');
  assert.equal(isMcpEnabled(readChatToolSourceMode({})), false);
  assert.equal(isBuiltinEnabled(readChatToolSourceMode({})), true);
});

test('unparseable values fail safe to builtin, never to mcp', () => {
  for (const raw of ['', '   ', 'yes', 'true', 'on', 'MCP!', 'builtinn', undefined, null, 7, {}]) {
    assert.equal(parseChatToolSourceMode(raw), 'builtin', `${JSON.stringify(raw)} -> builtin`);
  }
});

test('recognised values and aliases parse, case- and space-insensitively', () => {
  assert.equal(parseChatToolSourceMode('mcp'), 'mcp');
  assert.equal(parseChatToolSourceMode('MCP'), 'mcp');
  assert.equal(parseChatToolSourceMode(' remote '), 'mcp');
  assert.equal(parseChatToolSourceMode('both'), 'both');
  assert.equal(parseChatToolSourceMode('Merge'), 'both');
  assert.equal(parseChatToolSourceMode('builtin'), 'builtin');
  assert.equal(parseChatToolSourceMode('built-in'), 'builtin');
  assert.equal(parseChatToolSourceMode('local'), 'builtin');
});

test('the env var name is the documented one', () => {
  assert.equal(CHAT_TOOL_SOURCE_ENV, 'DEMOTOOLS_CHAT_TOOL_SOURCE');
  assert.equal(readChatToolSourceMode({ DEMOTOOLS_CHAT_TOOL_SOURCE: 'mcp' }), 'mcp');
  assert.equal(readChatToolSourceMode({ DEMOTOOLS_CHAT_TOOL_SOURCE: 'both' }), 'both');
});

test('builtin mode never calls the MCP source', async () => {
  let called = false;
  const merged = await resolveToolSources({
    mode: 'builtin',
    mcp: async () => {
      called = true;
      return source('search_products', 'from-mcp');
    },
    builtin: source('search_products', 'from-builtin'),
  });

  assert.equal(called, false, 'MCP must not even be contacted when off');
  assert.equal(merged.tools[0].function.description, 'from-builtin');
});

test('mcp mode excludes the builtin pack', async () => {
  const merged = await resolveToolSources({
    mode: 'mcp',
    mcp: async () => source('search_products', 'from-mcp'),
    builtin: source('search_products', 'from-builtin'),
  });

  assert.equal(merged.tools.length, 1);
  assert.equal(merged.tools[0].function.description, 'from-mcp');
});

test('precedence is mcp -> builtin -> local', async () => {
  const merged = await resolveToolSources({
    mode: 'both',
    mcp: async () => source('search_products', 'from-mcp'),
    builtin: source('search_products', 'from-builtin'),
    local: source('search_products', 'from-app'),
  });

  assert.equal(merged.tools.length, 1, 'same name collapses to one tool');
  assert.equal(
    merged.tools[0].function.description,
    'from-app',
    "the app's own tool must win so a demo can override the pack",
  );

  const result = await merged.toolRegistry.search_products({}, {});
  assert.equal(result.toolPayload, 'from-app', 'the handler must match the definition');
});

test('builtin shadows mcp when the app has no opinion', async () => {
  const merged = await resolveToolSources({
    mode: 'both',
    mcp: async () => source('search_products', 'from-mcp'),
    builtin: source('search_products', 'from-builtin'),
  });
  assert.equal(merged.tools[0].function.description, 'from-builtin');
});

test('distinct names from all sources are all kept', async () => {
  const merged = await resolveToolSources({
    mode: 'both',
    mcp: async () => source('read_categories', 'mcp-only'),
    builtin: source('search_products', 'builtin-only'),
    local: source('add_to_cart', 'app-only'),
  });

  assert.deepEqual(
    merged.tools.map((t) => t.function.name).sort(),
    ['add_to_cart', 'read_categories', 'search_products'],
  );
});

// A remote tool source is an enhancement, not a hard dependency. An MCP server
// that is down, or whose credentials rotated, must degrade to the local tools
// rather than taking the whole chat turn down.
test('a failing MCP source degrades instead of throwing', async () => {
  let reported;
  const merged = await resolveToolSources({
    mode: 'both',
    mcp: async () => {
      throw new Error('mcp server unreachable');
    },
    builtin: source('search_products', 'from-builtin'),
    local: source('add_to_cart', 'from-app'),
    onMcpError: (e) => {
      reported = e;
    },
  });

  assert.equal(reported?.message, 'mcp server unreachable', 'the demo gets told');
  assert.deepEqual(
    merged.tools.map((t) => t.function.name).sort(),
    ['add_to_cart', 'search_products'],
    'the turn still has its local tools',
  );
});

test('missing sources are simply absent', async () => {
  const merged = await resolveToolSources({ mode: 'builtin' });
  assert.deepEqual(merged.tools, []);
  assert.deepEqual(merged.toolRegistry, {});
});
