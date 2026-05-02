'use client';

import { type FormEvent, useState } from 'react';
import type { ChatAddress } from '../types.js';

export interface ChatAddressFormLabels {
  shippingAddress: string;
  firstName: string;
  lastName: string;
  streetName: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
  placeOrder: string;
  placingOrder: string;
}

export interface ChatAddressFormProps {
  prefill?: ChatAddress;
  /** ISO country to pre-fill when `prefill?.country` is missing. */
  defaultCountry: string;
  /** Render the email field. B2C anonymous flows need this; B2B does not. */
  showEmailField?: boolean;
  labels: ChatAddressFormLabels;
  /**
   * Called with the submitted address. Caller is responsible for queueing
   * a `pushUiAction` and triggering the next agent turn.
   */
  onSubmit: (address: ChatAddress) => Promise<void> | void;
}

const inputCls =
  'rounded border border-slate-300 px-2 py-1 text-[12px] focus:border-slate-900 focus:outline-none';

export function ChatAddressForm({
  prefill,
  defaultCountry,
  showEmailField,
  labels,
  onSubmit,
}: ChatAddressFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<ChatAddress>({
    firstName: prefill?.firstName ?? '',
    lastName: prefill?.lastName ?? '',
    streetName: prefill?.streetName ?? '',
    city: prefill?.city ?? '',
    state: prefill?.state ?? '',
    postalCode: prefill?.postalCode ?? '',
    country: prefill?.country ?? defaultCountry,
    phone: prefill?.phone ?? '',
    email: prefill?.email ?? '',
  });

  const update = <K extends keyof ChatAddress>(key: K, value: ChatAddress[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 rounded-md border border-slate-200 bg-white p-3"
    >
      <p className="mb-2 text-[12px] font-semibold tracking-wide text-slate-500 uppercase">
        {labels.shippingAddress}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          required
          value={form.firstName}
          onChange={(e) => update('firstName', e.target.value)}
          placeholder={labels.firstName}
          className={inputCls}
        />
        <input
          required
          value={form.lastName}
          onChange={(e) => update('lastName', e.target.value)}
          placeholder={labels.lastName}
          className={inputCls}
        />
        <input
          required
          value={form.streetName}
          onChange={(e) => update('streetName', e.target.value)}
          placeholder={labels.streetName}
          className={`col-span-2 ${inputCls}`}
        />
        <input
          required
          value={form.city}
          onChange={(e) => update('city', e.target.value)}
          placeholder={labels.city}
          className={inputCls}
        />
        <input
          value={form.state ?? ''}
          onChange={(e) => update('state', e.target.value)}
          placeholder={labels.state}
          className={inputCls}
        />
        <input
          required
          value={form.postalCode}
          onChange={(e) => update('postalCode', e.target.value)}
          placeholder={labels.postalCode}
          className={inputCls}
        />
        <input
          required
          value={form.country}
          onChange={(e) => update('country', e.target.value.toUpperCase().slice(0, 2))}
          placeholder={labels.country}
          maxLength={2}
          className={inputCls}
        />
        {showEmailField && (
          <input
            required
            type="email"
            value={form.email ?? ''}
            onChange={(e) => update('email', e.target.value)}
            placeholder={labels.email}
            className={`col-span-2 ${inputCls}`}
          />
        )}
        <input
          value={form.phone ?? ''}
          onChange={(e) => update('phone', e.target.value)}
          placeholder={labels.phone}
          className={`col-span-2 ${inputCls}`}
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="mt-2 w-full rounded bg-slate-900 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-slate-700 disabled:bg-slate-300"
      >
        {submitting ? labels.placingOrder : labels.placeOrder}
      </button>
    </form>
  );
}
