/**
 * React components for the chat UI.
 *
 * Exported now (verbatim ports — identical between b2b and b2c, safe to share):
 *   - ChatActionChips
 *
 * Pending design (held back so the API doesn't ossify on day 1):
 *   - ChatProvider + useChat — context shape needs to accept demo-specific
 *     UiAction unions and artifact extras via generics. Sketch in the PR
 *     description.
 *   - ChatPanel — composes header (title, subtitle, mic/speaker/new-chat/
 *     close buttons) + scroller + composer. Branding props: title,
 *     subtitle, accentClass, greetingAnonymous(name), greetingLoggedIn(name).
 *   - ChatLauncher — round button / "Continue chat" pill. Pure presentational.
 *   - ChatMessage — Markdown body + artifact slots. Slots are pluggable so
 *     demos can register their own artifact renderers (StorePicker for B2B,
 *     PaymentForm for B2C, etc.) under known keys.
 *   - ChatComposer — textarea + send button. Trivial; ship as-is.
 *   - ChatProductRow / ChatProductTile — depends on the demo's cart hook.
 *     Tile needs: addItem(productId, variantId, qty) callback, optional
 *     PDP href builder.
 *   - ChatCartSummary, ChatOrderConfirmation, ChatAddressForm — depends on
 *     a `formatMoney(money) → string` callback supplied by the demo (b2c
 *     formatMoney takes (amount, currency); b2b takes (Money) — needs
 *     unifying first).
 *
 * The voice loop (useVoiceLoop) and useChatApi hook are pure utilities and
 * will land in the next iteration of this PR — see hooks/.
 */

export { ChatActionChips } from './ChatActionChips.js';
export type { ChatActionChipsProps } from './ChatActionChips.js';
