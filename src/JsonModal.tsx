'use client';

import { useState } from 'react';
import JsonViewer from './JsonViewer.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface JsonModalProps {
  /** Data to display in the JSON viewer. */
  data: any;
  /** Header label inside the modal. Defaults to "JSON". */
  title?: string;
  /** Label on the trigger button. Defaults to "JSON". */
  buttonLabel?: string;
  /** Override classes on the trigger button. */
  buttonClassName?: string;
}

const DEFAULT_BUTTON_CLASSES =
  'text-[10px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded';

/**
 * Trigger button that opens a fullscreen modal with a searchable JSON viewer.
 * Originally extracted from the Home Depot Mexico cart page; reusable for any
 * demo where the user wants to inspect the live shape of an object.
 */
export default function JsonModal({
  data,
  title = 'JSON',
  buttonLabel = 'JSON',
  buttonClassName = DEFAULT_BUTTON_CLASSES,
}: JsonModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={buttonClassName}
      >
        {open ? 'Hide' : buttonLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-[#1e1e1e] rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[#d4d4d4] text-sm font-mono">{title}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[#858585] hover:text-white text-lg"
              >
                &times;
              </button>
            </div>
            <JsonViewer data={data} />
          </div>
        </div>
      )}
    </>
  );
}
