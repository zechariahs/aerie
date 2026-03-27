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
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="p-6 w-80" style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-border)' }}>
        <h3 className="text-[13px] font-medium mb-1" style={{ color: 'var(--ae-text)' }}>{title}</h3>
        <p className="text-[11px] mb-4" style={{ color: 'var(--ae-text2)' }}>{description}</p>

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
            className="w-full text-center tracking-widest mb-2"
            style={{
              padding: '6px 8px',
              background: 'var(--ae-raised)',
              border: '1px solid var(--ae-border)',
              color: 'var(--ae-text)',
              fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
              fontSize: 12,
              outline: 'none',
            }}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
          />
          {error && <p className="text-[11px] mb-2" style={{ color: 'var(--ae-red)' }}>{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 text-[10px] uppercase tracking-[0.08em]"
              style={{
                padding: '5px 12px',
                background: 'transparent',
                border: '1px solid var(--ae-border-hi)',
                color: 'var(--ae-text2)',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 text-[10px] uppercase tracking-[0.08em]"
              style={{
                padding: '5px 12px',
                background: 'var(--ae-amber)',
                border: 'none',
                color: 'var(--ae-void)',
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
