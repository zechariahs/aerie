// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' — this component uses event handlers and React state
'use client';

import { useState } from 'react';

interface TotpDialogProps {
  title: string;
  description: string;
  onConfirm: (totpToken: string) => void;
  onCancel: () => void;
}

/**
 * Modal dialog that prompts the user for a TOTP code before a write action.
 * The caller receives the raw token string and is responsible for including
 * it in the X-TOTP-Token header of the API request.
 */
export default function TotpDialog({ title, description, onConfirm, onCancel }: TotpDialogProps): React.JSX.Element {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const clean = token.trim();
    if (!/^\d{6}$/.test(clean)) {
      setError('Enter your 6-digit authenticator code');
      return;
    }
    setError('');
    onConfirm(clean);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#12121a] border border-[#1e1e2e] rounded-lg p-6 w-full max-w-sm shadow-xl">
        <h3 className="text-white font-semibold text-base mb-1">{title}</h3>
        <p className="text-[#6b7280] text-sm mb-4">{description}</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 text-white text-center text-lg tracking-[0.3em] font-mono placeholder-[#3f3f5a] focus:outline-none focus:border-[#6366f1]"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-3 py-2 rounded border border-[#1e1e2e] text-[#6b7280] text-sm hover:text-white hover:border-[#3f3f5a] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-3 py-2 rounded bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f52c9] transition-colors"
            >
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
