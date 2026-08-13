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

export { runChatTurn } from '../agent.js';
export type {
  AgentMessage,
  AgentToolCall,
  AgentTurnResult,
  ChatComplete,
  RunChatTurnInput,
} from '../agent.js';
