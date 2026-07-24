/**
 * Shown when the connected commercetools project's trial has expired, so the
 * project can no longer issue OAuth tokens and every storefront API call fails.
 * Render above the main content in the root layout — see `checkProjectActive()`
 * / `isProjectExpired()` in `@cboyke/demotools/ct/server`.
 *
 * Fatal (no data can load), so styled as an error rather than a warning.
 * Standard Tailwind classes only — the consumer's Tailwind must scan the
 * package's dist (see the package CLAUDE.md "Tailwind" note).
 */
export default function ProjectExpiredBanner() {
  return (
    <div role="alert" className="border-b border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
      <div className="mx-auto flex max-w-7xl flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <strong className="shrink-0 font-semibold">
          This commercetools project&apos;s trial has expired.
        </strong>
        <span className="text-red-800">
          The storefront can&apos;t load any data until the project is reactivated. Open the{' '}
          <a
            href="https://mc.commercetools.com/"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-red-700 underline-offset-2 hover:text-red-950"
          >
            Merchant Center
          </a>{' '}
          to renew the trial or convert it to a paid project, or point the deploy at an active
          project (<span className="font-medium">CTP_PROJECT_KEY</span> and credentials). No
          redeploy is needed once the project is active again.
        </span>
      </div>
    </div>
  );
}
