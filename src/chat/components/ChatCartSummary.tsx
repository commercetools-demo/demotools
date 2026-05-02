'use client';

import type { CartSummary, Money } from '../types.js';

export interface ChatCartSummaryLabels {
  yourCart: string;
  cartEmpty: string;
  total: string;
}

export interface ChatCartSummaryProps {
  cart: CartSummary;
  formatMoney: (money: Money) => string;
  labels: ChatCartSummaryLabels;
}

export function ChatCartSummary({ cart, formatMoney, labels }: ChatCartSummaryProps) {
  if (cart.itemCount === 0) {
    return (
      <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-center text-[12px] text-slate-500">
        {labels.cartEmpty}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-white p-3">
      <p className="mb-2 text-[12px] font-semibold tracking-wide text-slate-500 uppercase">
        {labels.yourCart}
      </p>
      <ul className="divide-y divide-slate-100">
        {cart.lineItems.map((li) => (
          <li
            key={li.id}
            className="flex items-center justify-between gap-2 py-1.5 text-[12px]"
          >
            <span className="flex-1 truncate text-slate-700">
              {li.name} <span className="text-slate-400">× {li.quantity}</span>
            </span>
            <span className="font-medium text-slate-900">{formatMoney(li.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-[13px] font-bold text-slate-900">
        <span>{labels.total}</span>
        <span>{cart.totalPrice ? formatMoney(cart.totalPrice) : '—'}</span>
      </div>
    </div>
  );
}
