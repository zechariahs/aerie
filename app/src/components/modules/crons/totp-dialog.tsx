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
      <div
        className="w-full max-w-sm p-6 shadow-xl"
        style={{
          background: 'var(--ae-surface)',
          border: '1px solid var(--ae-border)',
        }}
      >
        <h3 className="text-[13px] mb-1" style={{ color: 'var(--ae-text)' }}>{title}</h3>
        <p className="text-[11px] mb-4" style={{ color: 'var(--ae-text2)' }}>{description}</p>
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
            className="w-full text-center text-lg tracking-[0.3em]"
            style={{
              background: 'var(--ae-raised)',
              border: '1px solid var(--ae-border)',
              color: 'var(--ae-text)',
              fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
              padding: '8px 12px',
              outline: 'none',
            }}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber-dim)'; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
          />
          {error && (
            <p className="text-[10px]" style={{ color: 'var(--ae-red)' }}>{error}</p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 text-[10px] uppercase tracking-[0.08em] py-[7px] transition-colors"
              style={{
                fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
                background: 'transparent',
                border: '1px solid var(--ae-border-hi)',
                color: 'var(--ae-text2)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text2)'; }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 text-[10px] uppercase tracking-[0.08em] py-[7px] transition-opacity hover:opacity-80"
              style={{
                fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
                background: 'var(--ae-amber)',
                border: 'none',
                color: 'var(--ae-void)',
                cursor: 'pointer',
              }}
            >
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
