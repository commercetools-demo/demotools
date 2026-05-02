'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ChatLauncherLabels {
  /** Aria-label on the launcher button when chat is closed and there's no history. */
  open: string;
  /** Aria-label/text when chat is closed but the user has prior messages. */
  continueChat: string;
  /** Aria-label when chat is open. */
  close: string;
}

export interface ChatLauncherProps {
  isOpen: boolean;
  /** True if the conversation has any messages. Drives the "Continue chat" pill. */
  hasHistory: boolean;
  onToggle: () => void;
  labels: ChatLauncherLabels;
  /**
   * Optional ChatPanel content to portal into document.body alongside the
   * launcher button. Pass your `<ChatPanel />` here.
   */
  panel?: ReactNode;
  /** Class overrides for branding. */
  buttonClassNameRound?: string;
  buttonClassNamePill?: string;
}

const DEFAULT_ROUND =
  'fixed right-6 bottom-6 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg transition-transform hover:scale-105 hover:bg-slate-700';
const DEFAULT_PILL =
  'fixed right-6 bottom-6 z-[60] flex h-12 items-center gap-2 rounded-full bg-slate-900 px-5 text-white shadow-lg transition-transform hover:scale-105 hover:bg-slate-700';

const ChatIcon = (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
    />
  </svg>
);
const CloseIcon = (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);

export function ChatLauncher({
  isOpen,
  hasHistory,
  onToggle,
  labels,
  panel,
  buttonClassNameRound = DEFAULT_ROUND,
  buttonClassNamePill = DEFAULT_PILL,
}: ChatLauncherProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;
  const portalTarget = typeof document !== 'undefined' ? document.body : null;
  if (!portalTarget) return null;

  const showContinuePill = !isOpen && hasHistory;

  return createPortal(
    <>
      {panel}
      <button
        type="button"
        onClick={onToggle}
        className={showContinuePill ? buttonClassNamePill : buttonClassNameRound}
        aria-label={isOpen ? labels.close : showContinuePill ? labels.continueChat : labels.open}
      >
        {isOpen ? (
          CloseIcon
        ) : showContinuePill ? (
          <>
            {ChatIcon}
            <span className="text-sm font-semibold">{labels.continueChat}</span>
          </>
        ) : (
          ChatIcon
        )}
      </button>
    </>,
    portalTarget,
  );
}
