'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';

export interface ChatComposerLabels {
  /** Placeholder text inside the textarea. */
  placeholder: string;
  /** Aria-label on the send button. */
  send: string;
}

export interface ChatComposerProps {
  /** Called with the trimmed user text when they submit. */
  onSend: (text: string) => Promise<void> | void;
  /** Disabled while a turn is in flight. */
  isLoading: boolean;
  labels: ChatComposerLabels;
  /** Optional class overrides for branding. */
  formClassName?: string;
  textareaClassName?: string;
  buttonClassName?: string;
}

const DEFAULT_FORM = 'flex items-end gap-2 border-t border-slate-200 bg-white px-3 py-2';
const DEFAULT_TEXTAREA =
  'max-h-32 flex-1 resize-none rounded-md border border-slate-300 px-2 py-1.5 text-[13px] focus:border-slate-900 focus:outline-none';
const DEFAULT_BUTTON =
  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-slate-900 text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300';

export function ChatComposer({
  onSend,
  isLoading,
  labels,
  formClassName = DEFAULT_FORM,
  textareaClassName = DEFAULT_TEXTAREA,
  buttonClassName = DEFAULT_BUTTON,
}: ChatComposerProps) {
  const [text, setText] = useState('');

  const submit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    setText('');
    await onSend(trimmed);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={submit} className={formClassName}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={labels.placeholder}
        rows={1}
        className={textareaClassName}
      />
      <button
        type="submit"
        disabled={isLoading || text.trim().length === 0}
        className={buttonClassName}
        aria-label={labels.send}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
          />
        </svg>
      </button>
    </form>
  );
}
