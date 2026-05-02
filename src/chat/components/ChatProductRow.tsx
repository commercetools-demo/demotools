'use client';

import { type ReactNode } from 'react';
import type { ProductSummary } from '../types.js';

export interface ChatProductRowProps {
  products: ProductSummary[];
  /** How to render each product. Wire your own ChatProductTile here. */
  renderTile: (product: ProductSummary) => ReactNode;
}

export function ChatProductRow({ products, renderTile }: ChatProductRowProps) {
  if (products.length === 0) return null;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {products.map((product) => (
        <div key={product.id}>{renderTile(product)}</div>
      ))}
    </div>
  );
}
