/**
 * Public chat types — the contract between the library and demos.
 *
 * Anything a demo needs to construct or consume goes here. Internal-only
 * agent state stays in agent.ts.
 */

export interface Money {
  centAmount: number;
  currencyCode: string;
  fractionDigits?: number;
}

export interface ChatAddress {
  firstName: string;
  lastName: string;
  streetName: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
  /** Required when the user is not signed in (B2C guest checkout). */
  email?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A clickable suggestion chip rendered below an assistant turn. */
export interface ActionSuggestion {
  label: string;
  query: string;
}

/**
 * Open-ended UI action discriminator.
 *
 * Demos extend this via TS module augmentation or by passing a wider type
 * union as the generic to `ChatTurnRequest<UiAction>`. The library defaults
 * to the common set; B2B demos add `store_changed`, `business_unit_changed`;
 * B2C demos add `payment_provided`; etc.
 */
export type UiActionBase =
  | { type: 'added_to_cart'; productId: string; productName: string; quantity: number }
  | { type: 'navigated_to_pdp'; productId: string; productName: string }
  | { type: 'address_provided'; address: ChatAddress };

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  sku: string;
  imageUrl: string | null;
  price: Money | null;
  variantId: number;
  inStock: boolean;
}

export interface CartLineSummary {
  id: string;
  name: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}

export interface CartSummary {
  itemCount: number;
  totalPrice: Money | null;
  lineItems: CartLineSummary[];
}

export interface OrderSummary {
  id: string;
  orderNumber: string | null;
  totalPrice: Money | null;
}

/**
 * Bag of artifacts a tool can attach to its turn result. Demos extend this
 * via the `ToolExecutionResult<Extra>` generic when they need to surface
 * domain-specific cards (store pickers, BU pickers, etc.) to the UI.
 */
export interface CommonArtifacts {
  products?: ProductSummary[];
  cart?: CartSummary;
  order?: OrderSummary;
  /** Locale-relative path the chat client should router.push to. */
  navigateTo?: string;
  /** Up to ~4 quick-action chips rendered under the assistant message. */
  suggestions?: ActionSuggestion[];
}

export interface ToolExecutionResult<Extra = Record<string, unknown>> {
  /** Stringified payload sent back to the model as the tool result. */
  toolPayload: unknown;
  isError?: boolean;
  /** Set-Cookie headers to forward to the browser. */
  setCookies?: string[];
  /** Common artifacts the renderer knows how to display out of the box. */
  artifacts?: Partial<CommonArtifacts> & Extra;
}

/**
 * Tool definition. The library uses OpenAI's function-call shape verbatim.
 * If you want Anthropic-style tools, supply a different `runTurn` driver.
 */
export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * A demo-supplied tool implementation: name → handler.
 *
 * The handler receives the parsed arguments and a `ctx` opaque to the
 * library — typically the demo's session shape, locale, origin, and any
 * cookies needed for internal fetches.
 */
export interface ToolHandler<Ctx = unknown, Extra = Record<string, unknown>> {
  (args: unknown, ctx: Ctx): Promise<ToolExecutionResult<Extra>>;
}

export type ToolRegistry<Ctx = unknown, Extra = Record<string, unknown>> = Record<
  string,
  ToolHandler<Ctx, Extra>
>;

export interface ChatTurnRequest<UiAction = UiActionBase> {
  messages: ChatMessage[];
  uiActions?: UiAction[];
  language: string;
  recentProducts?: ProductSummary[];
}

export interface ChatTurnResponse<Extra = Record<string, unknown>>
  extends Partial<CommonArtifacts> {
  text: string;
  needsAddress?: boolean;
  prefillAddress?: ChatAddress;
  /** Domain-specific extras from tools (e.g. stores, businessUnits, savedCards). */
  extras?: Extra;
  error?: string;
}
