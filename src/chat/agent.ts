/**
 * Agent loop — vendor-neutral.
 *
 * The library does NOT take a hard dependency on `openai`. Instead, the
 * caller passes a `chatComplete` function that conforms to OpenAI's
 * Chat Completions function-call shape. This keeps the library small and
 * lets demos pin whichever SDK version they like.
 */

import type {
  ActionSuggestion,
  ChatAddress,
  ChatMessage,
  ChatTurnResponse,
  CommonArtifacts,
  Tool,
  ToolRegistry,
  UiActionBase,
} from './types.js';

const DEFAULT_MAX_ITERATIONS = 8;

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** Present on assistant messages that requested tool calls. */
  tool_calls?: AgentToolCall[];
  /** Present on tool result messages — the id of the call being answered. */
  tool_call_id?: string;
}

export interface AgentToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * Driver function. Implement against your LLM SDK of choice.
 * The shape mirrors OpenAI's Chat Completions response.
 */
export interface ChatComplete {
  (input: {
    messages: AgentMessage[];
    tools: Tool[];
    model?: string;
  }): Promise<{
    finish_reason: 'stop' | 'tool_calls' | string;
    message: AgentMessage;
  }>;
}

export interface RunChatTurnInput<Ctx, UiAction = UiActionBase> {
  messages: ChatMessage[];
  uiActions?: UiAction[];
  recentProducts?: ChatTurnResponse['products'];
  language: string;
  /** Demo-specific context handed to every tool handler. */
  ctx: Ctx;
  /** System prompt computed from current session/state. */
  systemPrompt: string;
  /** Tool definitions visible to the model. */
  tools: Tool[];
  /** Tool name → handler. */
  toolRegistry: ToolRegistry<Ctx>;
  /** LLM driver — see `ChatComplete`. */
  chatComplete: ChatComplete;
  /** Optional: format a UI action into a system-reminder line. */
  formatUiAction?: (action: UiAction) => string;
  /**
   * Optional address-detection hook. Returns true when the assistant's final
   * text is asking the user for a shipping address. Library default is the
   * lenient regex used by b2b/b2c.
   */
  detectAddressRequest?: (text: string, language: string) => boolean;
  /**
   * Optional fallback when LLM returns empty content. Library default is a
   * locale-aware "couldn't complete" message.
   */
  fallbackText?: (language: string) => string;
  maxIterations?: number;
  model?: string;
}

export interface AgentTurnResult<Extra = Record<string, unknown>>
  extends ChatTurnResponse<Extra> {
  /** Set-Cookie headers from internal route fetches; the API route forwards them. */
  setCookies: string[];
}

const DEFAULT_FORMAT_UI_ACTION = (action: UiActionBase): string => {
  switch (action.type) {
    case 'added_to_cart':
      return `User clicked "Add to cart" on product "${action.productName}" (productId=${action.productId}, qty=${action.quantity}). THE CART ALREADY INCLUDES IT — do NOT call add_to_cart again. Call view_cart to see the current contents, then briefly confirm and offer next-step chips via suggest_actions.`;
    case 'navigated_to_pdp':
      return `User clicked through to the PDP for "${action.productName}" (productId=${action.productId}).`;
    case 'address_provided':
      return `User submitted a shipping address via the inline form: ${JSON.stringify(action.address)}. Call submit_order with this address now.`;
  }
};

const DEFAULT_DETECT_ADDRESS = (text: string, language: string): boolean => {
  const lowered = text.toLowerCase();
  const lang = language.toLowerCase();
  if (lang.startsWith('es')) {
    return /(direcci[oó]n|domicilio|env[íi]o|d[oó]nde)/.test(lowered);
  }
  if (lang.startsWith('de')) {
    return /(lieferadresse|versandadresse|adresse|wohin)/.test(lowered);
  }
  if (lang.startsWith('fr')) {
    return /(adresse|livraison|exp[ée]dition)/.test(lowered);
  }
  return /(shipping|delivery|ship to|ship-to|where.*ship|deliver to|address|postcode|postal code|zip code)/.test(
    lowered,
  );
};

const DEFAULT_FALLBACK = (language: string): string => {
  const lang = language.toLowerCase();
  if (lang.startsWith('es'))
    return 'No pude completar la solicitud. ¿Puedes intentar de otra manera?';
  if (lang.startsWith('de'))
    return 'Ich konnte die Anfrage nicht abschließen. Bitte versuche es anders.';
  if (lang.startsWith('fr'))
    return "Je n'ai pas pu compléter la demande. Pouvez-vous reformuler ?";
  return "I couldn't complete that request. Could you try rephrasing?";
};

function injectSystemReminders<UiAction>(
  messages: ChatMessage[],
  uiActions: UiAction[],
  recentProducts: NonNullable<ChatTurnResponse['products']>,
  formatUiAction: (a: UiAction) => string,
): AgentMessage[] {
  const result: AgentMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const reminders: string[] = [];
  if (recentProducts.length > 0) {
    const list = recentProducts
      .map((p, i) => `${i + 1}. productId="${p.id}" variantId=${p.variantId} name="${p.name}"`)
      .join('\n');
    reminders.push(
      `These products were displayed to the user in the previous assistant turn. When the user references "the first one", "second", etc., resolve to a productId from this list and pass it directly to add_to_cart — do NOT invent IDs:\n${list}`,
    );
  }
  if (uiActions.length > 0) {
    reminders.push(
      `The user took these actions in the UI since the previous turn: ${uiActions
        .map(formatUiAction)
        .join(' ')}`,
    );
  }
  if (reminders.length > 0 && result.length > 0) {
    const last = result[result.length - 1];
    if (last.role === 'user' && typeof last.content === 'string') {
      const block = `\n\n<system-reminder>\n${reminders.join('\n\n')}\n</system-reminder>`;
      result[result.length - 1] = { ...last, content: last.content + block };
    }
  }
  return result;
}

/**
 * Run a single chat turn.
 *
 * Iterates LLM ↔ tools until the model returns finish_reason=stop or hits
 * MAX_ITERATIONS. Aggregates tool artifacts and forwards Set-Cookie headers.
 */
export async function runChatTurn<Ctx, UiAction = UiActionBase, Extra = Record<string, unknown>>(
  input: RunChatTurnInput<Ctx, UiAction>,
): Promise<AgentTurnResult<Extra>> {
  const {
    messages,
    uiActions = [],
    recentProducts = [],
    language,
    ctx,
    systemPrompt,
    tools,
    toolRegistry,
    chatComplete,
    formatUiAction,
    detectAddressRequest = DEFAULT_DETECT_ADDRESS,
    fallbackText = DEFAULT_FALLBACK,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    model,
  } = input;

  const fmt = (formatUiAction ??
    (DEFAULT_FORMAT_UI_ACTION as unknown as (a: UiAction) => string)) as (a: UiAction) => string;

  let working: AgentMessage[] = [
    { role: 'system', content: systemPrompt },
    ...injectSystemReminders<UiAction>(messages, uiActions, recentProducts, fmt),
  ];

  const artifacts: Partial<CommonArtifacts> & { extras?: Extra } = {};
  const extras = {} as Record<string, unknown>;
  const setCookies: string[] = [];
  let lastText = '';

  for (let i = 0; i < maxIterations; i++) {
    const { finish_reason, message } = await chatComplete({
      messages: working,
      tools,
      model,
    });
    const toolCalls = message.tool_calls ?? [];
    if (finish_reason === 'stop' || toolCalls.length === 0) {
      lastText = (message.content ?? '').trim();
      break;
    }

    working = [...working, { ...message, role: 'assistant' }];

    for (const call of toolCalls) {
      if (call.type !== 'function') continue;
      const handler = toolRegistry[call.function.name];
      let parsed: unknown = {};
      try {
        parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        parsed = {};
      }
      const result = handler
        ? await handler(parsed, ctx)
        : { toolPayload: { error: `Unknown tool: ${call.function.name}` }, isError: true };

      // Common artifacts merged automatically; everything else flows through `extras`.
      if (result.artifacts) {
        const { products, cart, order, navigateTo, suggestions, ...rest } = result.artifacts;
        if (products) artifacts.products = products;
        if (cart) artifacts.cart = cart;
        if (order) artifacts.order = order;
        if (navigateTo) artifacts.navigateTo = navigateTo;
        if (suggestions) artifacts.suggestions = suggestions as ActionSuggestion[];
        Object.assign(extras, rest);
      }
      if (result.setCookies?.length) setCookies.push(...result.setCookies);

      working.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result.toolPayload),
      });
    }
  }

  if (!lastText) lastText = fallbackText(language);

  let needsAddress = false;
  let prefillAddress: ChatAddress | undefined;
  if (
    !artifacts.order &&
    artifacts.cart &&
    artifacts.cart.itemCount > 0 &&
    detectAddressRequest(lastText, language)
  ) {
    needsAddress = true;
    // Note: prefill is not auto-loaded by the library — demos provide it via
    // their tool that resolves the user's default address (BU default in B2B,
    // customer default in B2C). They can attach it as `extras.prefillAddress`.
    prefillAddress = (extras as { prefillAddress?: ChatAddress }).prefillAddress;
  }

  return {
    text: lastText,
    products: artifacts.products,
    cart: artifacts.cart,
    order: artifacts.order,
    navigateTo: artifacts.navigateTo,
    suggestions: artifacts.suggestions,
    needsAddress: needsAddress || undefined,
    prefillAddress,
    extras: Object.keys(extras).length > 0 ? (extras as Extra) : undefined,
    setCookies,
  };
}
