/**
 * Thin fetch wrapper for /api/chat. Intentionally minimal — the heavy
 * lifting happens server-side in `runChatTurn`.
 */

import type { ChatTurnRequest, ChatTurnResponse } from '../types.js';

export async function postChatTurn<UiAction = unknown, Extra = Record<string, unknown>>(
  req: ChatTurnRequest<UiAction>,
  endpoint = '/api/chat',
): Promise<ChatTurnResponse<Extra>> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Chat request failed (${res.status})`);
  }
  return (await res.json()) as ChatTurnResponse<Extra>;
}
