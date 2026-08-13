/**
 * Money in tool payloads — the fields an LLM is allowed to see.
 *
 * ## Why this module exists
 *
 * A tool that returns `priceCentAmount: 950000` is a trap. The field is
 * correct, the name is nearly right, and the model has no way to tell the
 * difference between "950000 pence" and "950,000 pounds" — so sooner or later
 * it writes the second one. This is not hypothetical: an Atlas (b2b-starter)
 * demo shipped a chat reply listing "£1,100,000" for an excavator while the
 * product tile immediately below it, rendered from the very same tool result,
 * said £11,000.00. Every line in that reply was 100x high.
 *
 * The usual reflex is to add a system-prompt rule. That demo already had two
 * ("never quote numbers from tool output", "the UI formats prices for you") and
 * the model broke both. Prose cannot make an integer unambiguous; naming and
 * pre-formatting can. So:
 *
 *   - Every money value a tool returns gets a `<name>Display` string, already
 *     formatted by the demo's own `formatMoney` — the same function the product
 *     tiles use, so chat prose and chat artifacts can never disagree.
 *   - The raw integer, if a demo needs it for arithmetic, is named
 *     `<name>MinorUnits`, which is not a currency amount under any reading.
 *   - `PRICE_FIELD_GUIDE` travels inside the payload, next to the fields it
 *     describes, so the rule is where the model is actually looking.
 *
 * Keep the system-prompt rules as well. This is the layer that has to hold.
 *
 * ## Usage
 *
 * ```ts
 * import { moneyFields, PRICE_FIELD_GUIDE } from '@cboyke/demotools/chat';
 *
 * const fmt = (m: Money) => formatMoney(m, displayLocale);
 *
 * toolPayload = {
 *   count: products.length,
 *   results: products.map((p) => ({
 *     id: p.id,
 *     name: p.name,
 *     ...moneyFields('price', p.price, fmt),   // → priceDisplay, priceMinorUnits
 *     currency: p.price?.currencyCode ?? null,
 *   })),
 *   priceFieldGuide: PRICE_FIELD_GUIDE,
 * };
 * ```
 *
 * Demos whose formatter takes `(centAmount, currency)` rather than a `Money`
 * pass a one-line adapter: `(m) => formatMoney(m.centAmount, m.currencyCode)`.
 */

import type { Money } from './types.js';

/** CT's centPrecision default, used when a Money carries no fractionDigits. */
const DEFAULT_FRACTION_DIGITS = 2;

/** Formats a Money for display. Supply the demo's own formatter so chat text matches chat UI. */
export type MoneyFormatter = (money: Money) => string;

export interface MoneyDescription {
  /** Formatted for this user's locale and currency, e.g. "£9,500.00". Safe to quote verbatim. */
  display: string;
  /** Exact amount in the currency's minor unit, e.g. 950000. Arithmetic only — never displayed. */
  minorUnits: number;
  currency: string;
  fractionDigits: number;
}

/**
 * Describe a Money for a tool payload, or `null` if there is no price (an
 * unpriced product, an empty cart). Returning `null` rather than a zero keeps
 * "no price" distinguishable from "free".
 */
export function describeMoney(
  money: Money | null | undefined,
  formatMoney: MoneyFormatter
): MoneyDescription | null {
  if (!money || typeof money.centAmount !== 'number' || !money.currencyCode) return null;
  return {
    display: formatMoney(money),
    minorUnits: money.centAmount,
    currency: money.currencyCode,
    fractionDigits: money.fractionDigits ?? DEFAULT_FRACTION_DIGITS,
  };
}

/** The two keys `moneyFields` produces for a given prefix. */
export type MoneyFields<Prefix extends string> = {
  [K in `${Prefix}Display`]: string | null;
} & {
  [K in `${Prefix}MinorUnits`]: number | null;
};

/**
 * Spread-ready money fields for a tool payload:
 * `moneyFields('lineTotal', …)` → `{ lineTotalDisplay, lineTotalMinorUnits }`.
 *
 * Prefixes are part of the model's vocabulary — prefer `price`, `total`,
 * `unitPrice`, `lineTotal`. Do NOT introduce a prefix ending in `CentAmount`;
 * that is the shape this module exists to retire.
 */
export function moneyFields<Prefix extends string>(
  prefix: Prefix,
  money: Money | null | undefined,
  formatMoney: MoneyFormatter
): MoneyFields<Prefix> {
  const described = describeMoney(money, formatMoney);
  // Computed template-literal keys can't be inferred from an object literal,
  // hence the assertion. The MoneyFields<Prefix> type is the contract.
  return {
    [`${prefix}Display`]: described?.display ?? null,
    [`${prefix}MinorUnits`]: described?.minorUnits ?? null,
  } as MoneyFields<Prefix>;
}

/**
 * Ship this inside any tool payload that carries money, under a
 * `priceFieldGuide` key. It restates the `*Display` / `*MinorUnits` contract
 * where the model reads the data rather than where it read the prompt.
 */
export const PRICE_FIELD_GUIDE =
  'Fields ending in "Display" are already formatted for this user (locale + currency) — ' +
  'if you mention a price, copy that string verbatim. Fields ending in "MinorUnits" are ' +
  "integers in the currency's minor unit (e.g. pence, cents): divide by 10^fractionDigits " +
  'before any arithmetic and NEVER show one to the user.';
