/**
 * React components for the chat UI.
 *
 * All components in this barrel are headless / presentational — they don't
 * import a context or i18n hook. Demos wrap them with a thin shim that
 * supplies the hooks (useChat, useTranslations, useFormatters) and any
 * routing primitives (Next.js Link, Image).
 *
 * Composing components stay per-demo for now — see DESIGN.md for the
 * rationale on what's NOT in this barrel and the v5 plan:
 *   - ChatProvider / useChat (generic shape needs review)
 *   - ChatPanel (slot-based design pending)
 *   - ChatMessage artifact router
 */

export { ChatActionChips } from './ChatActionChips.js';
export type { ChatActionChipsProps } from './ChatActionChips.js';

export { ChatComposer } from './ChatComposer.js';
export type { ChatComposerLabels, ChatComposerProps } from './ChatComposer.js';

export { ChatLauncher } from './ChatLauncher.js';
export type { ChatLauncherLabels, ChatLauncherProps } from './ChatLauncher.js';

export { ChatProductRow } from './ChatProductRow.js';
export type { ChatProductRowProps } from './ChatProductRow.js';

export { ChatProductTile } from './ChatProductTile.js';
export type { ChatProductTileLabels, ChatProductTileProps } from './ChatProductTile.js';

export { ChatCartSummary } from './ChatCartSummary.js';
export type { ChatCartSummaryLabels, ChatCartSummaryProps } from './ChatCartSummary.js';

export { ChatOrderConfirmation } from './ChatOrderConfirmation.js';
export type {
  ChatOrderConfirmationLabels,
  ChatOrderConfirmationProps,
} from './ChatOrderConfirmation.js';

export { ChatAddressForm } from './ChatAddressForm.js';
export type { ChatAddressFormLabels, ChatAddressFormProps } from './ChatAddressForm.js';
