/**
 * Shown when the connected CT project hasn't activated the Product Search API.
 * Render above the main content in the root layout — see the product-search
 * status helpers in `@cboyke/demotools/ct/server`.
 *
 * Standard Tailwind classes only (see the package CLAUDE.md "Tailwind" note).
 */
export default function ProductSearchDisabledBanner() {
  return (
    <div
      role="alert"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <strong className="shrink-0 font-semibold">
          Product Search isn&apos;t enabled on this commercetools project.
        </strong>
        <span className="text-amber-800">
          Open the{' '}
          <a
            href="https://mc.commercetools.com/"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-amber-700 underline-offset-2 hover:text-amber-950"
          >
            Merchant Center
          </a>
          {' → '}
          <span className="font-medium">Settings → Project settings → Storefront Search</span>{' '}
          and activate it. Product listings will be empty until indexing finishes (usually a few
          minutes).
        </span>
      </div>
    </div>
  );
}
