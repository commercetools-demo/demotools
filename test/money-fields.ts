// Type-level regression test: `moneyFields(prefix, …)` must produce exactly
// `${prefix}Display: string | null` and `${prefix}MinorUnits: number | null`.
//
// This exists because the implementation builds those keys with computed
// template-literal properties and asserts the result to `MoneyFields<Prefix>`.
// An assertion is a promise, not a proof — if the literal and the type drift
// apart (a renamed key, a widened prefix that infers as `string`, a lost
// `| null`), nothing in the library fails to compile and the mismatch only
// surfaces as a demo shipping a field name the model was never told about.
//
// The `centAmount` case at the bottom is the actual bug this module was written
// to retire: a payload field named `priceCentAmount` carrying 950000 for a
// £9,500.00 excavator, which an LLM duly quoted as "£950,000".
//
// Run: npm test  (tsc --noEmit -p tsconfig.test.json)

import { describeMoney, moneyFields, PRICE_FIELD_GUIDE } from '../src/chat/money';
import type { MoneyDescription, MoneyFields } from '../src/chat/money';
import type { Money } from '../src/chat/types';

const fmt = (m: Money) => `£${(m.centAmount / 100).toFixed(2)}`;
const price: Money = { centAmount: 950000, currencyCode: 'GBP', fractionDigits: 2 };

// Exact-shape equality — invariant in both directions, so a missing key, an
// extra key, or a widened value type all fail.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
declare function exact<Expected>(): <Actual>(actual: Actual) => Exact<Actual, Expected>;

const priceFields = moneyFields('price', price, fmt);
const priceShape: true = exact<{
  priceDisplay: string | null;
  priceMinorUnits: number | null;
}>()(priceFields);

// A literal prefix must stay literal through inference — `string` here would
// silently degrade every payload key to `${string}Display`.
const totalShape: true = exact<{
  totalDisplay: string | null;
  totalMinorUnits: number | null;
}>()(moneyFields('total', null, fmt));

// Multi-word prefixes used by cart payloads.
const lineTotalShape: true = exact<{
  lineTotalDisplay: string | null;
  lineTotalMinorUnits: number | null;
}>()(moneyFields('lineTotal', price, fmt));

// The generic alias itself, independent of inference.
const aliasShape: true = exact<{
  unitPriceDisplay: string | null;
  unitPriceMinorUnits: number | null;
}>()({} as MoneyFields<'unitPrice'>);

// describeMoney is nullable — "no price" must stay distinguishable from "free".
const described: MoneyDescription | null = describeMoney(price, fmt);
const describedShape: true = exact<MoneyDescription | null>()(described);

// The guide is a plain string a demo can drop into a payload.
const guide: string = PRICE_FIELD_GUIDE;

// A `*Display` key is a string, never the raw integer — spreading money fields
// must not leak a number into a field a model is told it may quote verbatim.
const displayIsString: true = exact<string | null>()(priceFields.priceDisplay);
const minorUnitsIsNumber: true = exact<number | null>()(priceFields.priceMinorUnits);

// The retired shape must not reappear: `priceCentAmount` is not a key of the
// result, so indexing it is an error. @ts-expect-error fails the build if the
// property ever becomes valid again.
// @ts-expect-error — money payload fields are *Display / *MinorUnits, never *CentAmount
const noCentAmount = priceFields.priceCentAmount;

void [
  priceShape,
  totalShape,
  lineTotalShape,
  aliasShape,
  describedShape,
  guide,
  displayIsString,
  minorUnitsIsNumber,
  noCentAmount,
];
