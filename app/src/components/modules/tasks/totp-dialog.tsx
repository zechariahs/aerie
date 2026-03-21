// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

import { useState } from 'react';

interface TotpDialogProps {
  title: string;
  description: string;
  onConfirm: (token: string) => void;
  onCancel: () => void;
}

/**
 * Modal dialog that prompts for a TOTP token before confirming a write action.
 * Used for column moves, deletions, and other state-mutating operations.
 */
export function TotpDialog({ title, description, onConfirm, onCancel }: TotpDialogProps): React.JSX.Element {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (token.length !== 6 || !/^\d{6}$/.test(token)) {
      setError('Enter your 6-digit TOTP code');
      return;
    }
    setError('');
    onConfirm(token);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#12121a] border border-[#1e1e2e] rounded-lg p-6 w-80 shadow-xl">
        <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
        <p className="text-xs text-[#6b7280] mb-4">{description}</p>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
            className="w-full px-3 py-2 bg-[#0d0d14] border border-[#1e1e2e] rounded text-sm text-white placeholder-[#4b5563] focus:outline-none focus:border-[#3b82f6] tracking-widest text-center font-mono mb-2"
          />
          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-1.5 text-xs text-[#6b7280] border border-[#1e1e2e] rounded hover:text-white hover:border-[#374151] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-1.5 text-xs text-white bg-[#3b82f6] rounded hover:bg-[#2563eb] transition-colors"
            >
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
