/**
 * @cboyke/demotools/chat
 *
 * Vendor-neutral building blocks for AI chat assistants in commercetools demos.
 *
 * What's here (client-safe):
 *   - Types: shared shapes for tools, turns, artifacts, addresses, etc.
 *   - Components: presentational React pieces (ChatActionChips, ChatComposer,
 *     ChatLauncher, ChatProductRow, ChatProductTile, ChatCartSummary,
 *     ChatOrderConfirmation, ChatAddressForm)
 *   - Hooks: useVoiceLoop, postChatTurn
 *
 * Server-side helpers (route factories, agent loop) live under the `/server`
 * subpath so they don't pull a `'use client'` boundary on the client bundle:
 *
 *   import { runChatTurn, makeChatRoute } from '@cboyke/demotools/chat/server';
 */

export * from './types.js';
export * from './components/index.js';
export * from './hooks/index.js';
