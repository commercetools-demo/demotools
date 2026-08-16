export {
  makeChatRoute,
  type MakeChatRouteOptions,
} from './route-factories.js';

export {
  makeSpeakRoute,
  makeTranscribeRoute,
  type MakeSpeakRouteOptions,
  type MakeTranscribeRouteOptions,
} from './audio-routes.js';

export {
  createMcpToolSource,
  mergeToolSources,
  mcpToolToFunctionTool,
  inlineJsonSchemaRefs,
  type ToolSource,
  type McpToolSourceOptions,
} from './mcp-tools.js';

// The builtin-vs-MCP feature flag. The built-in pack itself lives at
// `@cboyke/demotools/chat/tools` — it is a separate subpath so a demo running
// MCP-only never pulls the pack's mappers into its bundle.
export {
  CHAT_TOOL_SOURCE_ENV,
  DEFAULT_CHAT_TOOL_SOURCE,
  isBuiltinEnabled,
  isMcpEnabled,
  parseChatToolSourceMode,
  readChatToolSourceMode,
  resolveToolSources,
  type ChatToolSourceMode,
  type ResolveToolSourcesInput,
} from './tool-source.js';

export {
  McpClient,
  McpError,
  McpTransportError,
  decodeMcpResult,
  type McpAuth,
  type McpCallResult,
  type McpClientOptions,
  type McpContentBlock,
  type McpToolDefinition,
} from './mcp-client.js';

// Re-exported from the client-safe entrypoint: tool handlers are server code
// and shouldn't have to import `/chat` (and its React components) to format a
// price for a tool payload.
export {
  describeMoney,
  moneyFields,
  PRICE_FIELD_GUIDE,
  type MoneyDescription,
  type MoneyFields,
  type MoneyFormatter,
} from '../money.js';

export { runChatTurn } from '../agent.js';
export type {
  AgentMessage,
  AgentToolCall,
  AgentTurnResult,
  ChatComplete,
  RunChatTurnInput,
} from '../agent.js';
