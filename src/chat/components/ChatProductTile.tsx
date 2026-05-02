'use client';

import { type ComponentType, type ReactNode, useRef, useState } from 'react';
import type { Money, ProductSummary } from '../types.js';

export interface ChatProductTileLabels {
  addToCart: string;
  added: string;
  adding: string;
  outOfStock: string;
  view: string;
  viewPdp: string;
  noImage: string;
  priceOnRequest: string;
}

export interface ChatProductTileProps {
  product: ProductSummary;
  formatMoney: (money: Money) => string;
  labels: ChatProductTileLabels;
  /**
   * Add-to-cart handler. Should resolve only after the cart has been
   * mutated. The component handles the ref-based double-click lock and
   * "added" state on its own.
   */
  onAdd: (product: ProductSummary) => Promise<void>;
  /** Locale-relative href to the PDP. Pass null/undefined when not navigable. */
  pdpHref?: string | null;
  /**
   * Click handler for the View action. Fired alongside the link click —
   * use to push UI actions, close the chat panel, etc.
   */
  onView?: (product: ProductSummary) => void;
  /**
   * Render an image element. Default uses a plain `<img>` with `unoptimized`
   * semantics. Pass a wrapper around `next/image` here to enable Next's
   * image optimization (recommended for production demos).
   */
  ImageComponent?: ComponentType<{ src: string; alt: string; className?: string }>;
  /**
   * Render the View link. Default uses a plain `<a>`. Pass a Next.js `Link`
   * (or your routing primitive) here to get prefetch on hover.
   */
  LinkComponent?: ComponentType<{
    href: string;
    onClick?: () => void;
    className?: string;
    'aria-label'?: string;
    children: ReactNode;
  }>;
}

const PlainImg: ComponentType<{ src: string; alt: string; className?: string }> = ({
  src,
  alt,
  className,
}) => <img src={src} alt={alt} className={className} loading="lazy" />;

const PlainLink: ChatProductTileProps['LinkComponent'] = ({ href, onClick, className, children, ...rest }) => (
  <a href={href} onClick={onClick} className={className} {...rest}>
    {children}
  </a>
);

export function ChatProductTile({
  product,
  formatMoney,
  labels,
  onAdd,
  pdpHref,
  onView,
  ImageComponent = PlainImg,
  LinkComponent = PlainLink,
}: ChatProductTileProps) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  // useState's `adding` doesn't update synchronously, so a fast double-click
  // can fire the request twice before React re-renders the disabled state.
  // A ref locks the path immediately on the first click.
  const addingLock = useRef(false);

  const handleAdd = async () => {
    if (addingLock.current) return;
    addingLock.current = true;
    setAdding(true);
    try {
      await onAdd(product);
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    } catch (e) {
      console.error('[chat-tile] add failed', e);
    } finally {
      addingLock.current = false;
      setAdding(false);
    }
  };

  const handleView = () => {
    onView?.(product);
  };

  const ImageInner = product.imageUrl ? (
    <ImageComponent
      src={product.imageUrl}
      alt={product.name}
      className="h-full w-full object-contain"
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
      {labels.noImage}
    </div>
  );

  return (
    <div className="flex flex-col rounded-md border border-slate-200 bg-white p-1.5 shadow-sm">
      {pdpHref ? (
        <LinkComponent
          href={pdpHref}
          onClick={handleView}
          className="aspect-[5/3] w-full overflow-hidden rounded border border-slate-100 bg-slate-50"
          aria-label={labels.viewPdp}
        >
          {ImageInner}
        </LinkComponent>
      ) : (
        <div
          className="aspect-[5/3] w-full overflow-hidden rounded border border-slate-100 bg-slate-50"
          aria-label={labels.viewPdp}
        >
          {ImageInner}
        </div>
      )}

      {pdpHref ? (
        <LinkComponent
          href={pdpHref}
          onClick={handleView}
          className="mt-1.5 line-clamp-2 text-left text-[11px] leading-tight font-medium text-slate-900 hover:text-slate-600"
        >
          {product.name}
        </LinkComponent>
      ) : (
        <span className="mt-1.5 line-clamp-2 text-[11px] leading-tight font-medium text-slate-900">
          {product.name}
        </span>
      )}

      {product.price ? (
        <p className="mt-0.5 text-[12px] font-bold text-slate-900">
          {formatMoney(product.price)}
        </p>
      ) : (
        <p className="mt-0.5 text-[10px] text-slate-400">{labels.priceOnRequest}</p>
      )}

      <div className="mt-1.5 flex gap-1">
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || product.inStock === false}
          aria-busy={adding}
          className="flex flex-1 items-center justify-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {adding && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          <span>
            {product.inStock === false
              ? labels.outOfStock
              : added
                ? labels.added
                : adding
                  ? labels.adding
                  : labels.addToCart}
          </span>
        </button>
        {pdpHref && (
          <LinkComponent
            href={pdpHref}
            onClick={handleView}
            className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-900 hover:text-slate-900"
          >
            {labels.view}
          </LinkComponent>
        )}
      </div>
    </div>
  );
}
