/**
 * commercetools SDK objects → chat UI artifacts, and → the shrunken payloads the
 * model sees.
 *
 * Two separate jobs, deliberately kept apart:
 *
 *   - `toProductSummary` / `toCartSummary` build the typed artifacts the chat
 *     panel renders (product tiles, cart cards). Full fidelity.
 *   - `productPayload` / `cartPayload` build what goes *back to the model*.
 *     Much smaller, and money is expressed via the `*Display` / `*MinorUnits`
 *     contract from `../money.js` so the model copies a formatted price verbatim
 *     instead of inventing "$1,299.00" from a centAmount.
 */

import type {
  Cart,
  Category,
  Channel,
  InventoryEntry,
  LineItem,
  LocalizedString,
  Order,
  Price,
  ProductProjection,
  ProductVariant,
  ShippingMethod,
  TypedMoney,
} from '@commercetools/platform-sdk';

import { moneyFields, type MoneyFormatter } from '../money.js';
import type {
  CartLineSummary,
  CartSummary,
  Money,
  OrderSummary,
  ProductSummary,
} from '../types.js';

/**
 * Resolve a localized string with sensible fallbacks.
 *
 * Demo catalogs are routinely seeded in one language while the storefront runs
 * another, so an exact-miss must not render as an empty product name. Order:
 * exact locale → same language, any region → `en`-anything → first value.
 */
export function localized(
  value: LocalizedString | undefined,
  locale: string,
): string {
  if (!value) return '';
  if (value[locale]) return value[locale];

  const lang = locale.split('-')[0];
  const sameLang = Object.keys(value).find((k) => k.split('-')[0] === lang);
  if (sameLang) return value[sameLang];

  const english = Object.keys(value).find((k) => k.split('-')[0] === 'en');
  if (english) return value[english];

  return Object.values(value)[0] ?? '';
}

function toMoney(money: TypedMoney | undefined | null): Money | null {
  if (!money || typeof money.centAmount !== 'number') return null;
  return {
    centAmount: money.centAmount,
    currencyCode: money.currencyCode,
    fractionDigits: money.fractionDigits,
  };
}

/** Effective price for a variant — the discounted value when one applies. */
function variantPrice(variant: ProductVariant | undefined): Money | null {
  const price: Price | undefined = variant?.price ?? variant?.prices?.[0];
  if (!price) return null;
  return toMoney(price.discounted?.value ?? price.value);
}

function inStock(variant: ProductVariant | undefined): boolean {
  const availability = variant?.availability;
  // No inventory tracking configured is not the same as out of stock — plenty of
  // demo catalogs sell untracked SKUs.
  if (!availability) return true;
  if (typeof availability.isOnStock === 'boolean') return availability.isOnStock;
  return (availability.availableQuantity ?? 0) > 0;
}

/**
 * Pick the variant to represent a product.
 *
 * With `markMatchingVariants` set, a SKU or attribute search marks the variant
 * that actually matched — showing the master variant's image and price there
 * would answer a question about the blue one with a picture of the grey one.
 */
function representativeVariant(
  product: ProductProjection,
): ProductVariant | undefined {
  const matching = product.variants?.find((v) => v.isMatchingVariant);
  if (matching) return matching;
  if (product.masterVariant?.isMatchingVariant) return product.masterVariant;
  return product.masterVariant ?? product.variants?.[0];
}

export function toProductSummary(
  product: ProductProjection,
  locale: string,
): ProductSummary | undefined {
  if (!product?.id) return undefined;
  const variant = representativeVariant(product);

  return {
    id: product.id,
    name: localized(product.name, locale),
    slug: localized(product.slug, locale),
    sku: variant?.sku ?? '',
    imageUrl: variant?.images?.[0]?.url ?? null,
    price: variantPrice(variant),
    variantId: variant?.id ?? 1,
    inStock: inStock(variant),
  };
}

export function toCartLineSummary(line: LineItem, locale: string): CartLineSummary {
  const unit =
    toMoney(line.price?.discounted?.value ?? line.price?.value) ?? {
      centAmount: 0,
      currencyCode: '',
    };

  return {
    id: line.id,
    name: localized(line.name, locale),
    quantity: line.quantity,
    unitPrice: unit,
    lineTotal:
      toMoney(line.totalPrice) ?? {
        centAmount: unit.centAmount * line.quantity,
        currencyCode: unit.currencyCode,
        fractionDigits: unit.fractionDigits,
      },
  };
}

export function toCartSummary(
  cart: Cart | undefined,
  locale: string,
): CartSummary {
  const lineItems = (cart?.lineItems ?? []).map((l) => toCartLineSummary(l, locale));
  return {
    itemCount:
      cart?.totalLineItemQuantity ?? lineItems.reduce((sum, l) => sum + l.quantity, 0),
    totalPrice: toMoney(cart?.totalPrice),
    lineItems,
  };
}

export function toOrderSummary(order: Order): OrderSummary {
  return {
    id: order.id,
    orderNumber: order.orderNumber ?? null,
    totalPrice: toMoney(order.totalPrice),
  };
}

// ── Model-facing payloads ────────────────────────────────────────────────────
// Smaller than the artifacts, and money always via moneyFields() so the model
// gets a formatted string to quote and an integer it is told not to show.

export function productPayload(p: ProductSummary, formatMoney: MoneyFormatter) {
  return {
    productId: p.id,
    name: p.name,
    sku: p.sku,
    variantId: p.variantId,
    inStock: p.inStock,
    ...moneyFields('price', p.price, formatMoney),
  };
}

export function cartPayload(cart: CartSummary, formatMoney: MoneyFormatter) {
  return {
    itemCount: cart.itemCount,
    ...moneyFields('total', cart.totalPrice, formatMoney),
    lines: cart.lineItems.map((l) => ({
      lineItemId: l.id,
      name: l.name,
      quantity: l.quantity,
      ...moneyFields('unitPrice', l.unitPrice, formatMoney),
      ...moneyFields('lineTotal', l.lineTotal, formatMoney),
    })),
  };
}

export function orderPayload(
  order: Order,
  locale: string,
  formatMoney: MoneyFormatter,
) {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber ?? null,
    status: order.orderState ?? null,
    placedAt: order.createdAt ?? null,
    ...moneyFields('total', toMoney(order.totalPrice), formatMoney),
    items: (order.lineItems ?? []).map((l) => ({
      name: localized(l.name, locale),
      quantity: l.quantity,
    })),
  };
}

export function categoryPayload(category: Category, locale: string) {
  return {
    categoryId: category.id,
    key: category.key ?? null,
    name: localized(category.name, locale),
    slug: localized(category.slug, locale),
    parentId: category.parent?.id ?? null,
  };
}

export function inventoryPayload(entry: InventoryEntry) {
  const quantity = entry.availableQuantity ?? entry.quantityOnStock ?? 0;
  return {
    sku: entry.sku,
    availableQuantity: quantity,
    inStock: quantity > 0,
    supplyChannelId: entry.supplyChannel?.id ?? null,
  };
}

export function storePayload(channel: Channel, locale: string) {
  // geoLocation is a GeoJson union; only Point carries coordinates.
  const geo = channel.geoLocation as { coordinates?: number[] } | undefined;
  const coords = geo?.coordinates;

  return {
    channelId: channel.id,
    key: channel.key ?? null,
    name: localized(channel.name, locale),
    address: channel.address
      ? [
          channel.address.streetName,
          channel.address.city,
          channel.address.state,
          channel.address.postalCode,
        ]
          .filter(Boolean)
          .join(', ')
      : null,
    // [longitude, latitude] per commercetools' GeoJSON ordering.
    longitude: coords?.[0] ?? null,
    latitude: coords?.[1] ?? null,
  };
}

export function shippingMethodPayload(
  method: ShippingMethod,
  locale: string,
  formatMoney: MoneyFormatter,
) {
  const rates = (method.zoneRates ?? []).flatMap((z) => z.shippingRates ?? []);
  const rate = rates.find((r) => r.isMatching) ?? rates[0];

  return {
    shippingMethodId: method.id,
    key: method.key ?? null,
    name: method.name || localized(method.localizedDescription, locale),
    ...moneyFields('price', toMoney(rate?.price), formatMoney),
  };
}

/** Default money formatter — Intl, driven by the session's locale + currency. */
export function defaultMoneyFormatter(
  locale: string,
  currency: string,
): MoneyFormatter {
  return (money: Money) => {
    const digits = money.fractionDigits ?? 2;
    const amount = money.centAmount / 10 ** digits;
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: money.currencyCode || currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(amount);
    } catch {
      // Unknown locale or currency code — never throw inside a tool handler.
      return `${amount.toFixed(digits)} ${money.currencyCode || currency}`.trim();
    }
  };
}
