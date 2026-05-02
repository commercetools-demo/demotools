'use client';

import type { Money, OrderSummary } from '../types.js';

export interface ChatOrderConfirmationLabels {
  orderPlaced: string;
  orderNumber: string;
  total: string;
}

export interface ChatOrderConfirmationProps {
  order: OrderSummary;
  formatMoney: (money: Money) => string;
  labels: ChatOrderConfirmationLabels;
}

export function ChatOrderConfirmation({
  order,
  formatMoney,
  labels,
}: ChatOrderConfirmationProps) {
  return (
    <div className="mt-2 rounded-md border border-green-200 bg-green-50 p-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">&#10003;</span>
        <p className="text-[13px] font-semibold text-green-800">{labels.orderPlaced}</p>
      </div>
      {order.orderNumber && (
        <p className="mt-1 text-[12px] text-green-700">
          {labels.orderNumber}: <span className="font-mono">{order.orderNumber}</span>
        </p>
      )}
      {order.totalPrice && (
        <p className="mt-0.5 text-[12px] text-green-700">
          {labels.total}: <span className="font-semibold">{formatMoney(order.totalPrice)}</span>
        </p>
      )}
    </div>
  );
}
