/**
 * ChatActionChips — clickable suggestion buttons rendered below an assistant
 * turn. Lifted verbatim from b2b/b2c (they were identical).
 *
 * Branding: pass `className` to override the wrapper, or replace this whole
 * component with your own — it's just an array of buttons.
 */

import { type FC } from 'react';
import type { ActionSuggestion } from '../types.js';

export interface ChatActionChipsProps {
  suggestions: ActionSuggestion[];
  /** Called when the user clicks a chip. Hand this to your ChatProvider's `sendMessage`. */
  onSelect: (query: string) => void;
  disabled?: boolean;
  /** Tailwind class on the outer wrapper. Defaults to flex-wrap row. */
  className?: string;
  /** Tailwind class on each chip. Defaults to slate pill. */
  chipClassName?: string;
}

const DEFAULT_WRAPPER = 'mt-1 flex flex-wrap gap-1.5';
const DEFAULT_CHIP =
  'rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-900 hover:bg-slate-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50';

export const ChatActionChips: FC<ChatActionChipsProps> = ({
  suggestions,
  onSelect,
  disabled,
  className = DEFAULT_WRAPPER,
  chipClassName = DEFAULT_CHIP,
}) => {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div className={className}>
      {suggestions.map((s, i) => (
        <button
          key={`${s.label}-${i}`}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(s.query)}
          className={chipClassName}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
};
