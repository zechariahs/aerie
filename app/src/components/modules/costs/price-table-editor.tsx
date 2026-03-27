// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' required — editable table with TOTP submit
'use client';

import React, { useEffect, useState } from 'react';
import type { ModelPrice } from '@/types';
import { basePath } from '@/lib/client-url';

function nowIso(): string {
  return new Date().toISOString();
}

const inputStyle: React.CSSProperties = {
  background: 'var(--ae-raised)',
  border: '1px solid var(--ae-border)',
  color: 'var(--ae-text)',
  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  fontSize: 11,
  padding: '3px 6px',
  outline: 'none',
};

export default function PriceTableEditor(): React.JSX.Element {
  const [rows, setRows] = useState<ModelPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [totpToken, setTotpToken] = useState('');

  useEffect(() => {
    fetch(basePath + '/api/costs/price-table')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as { data: ModelPrice[] };
        setRows(json.data);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, []);

  function updateRow(idx: number, field: keyof ModelPrice, value: string): void {
    setRows((prev) => {
      const next = [...prev];
      const row = { ...next[idx]! };
      if (field === 'inputPer1MTokens' || field === 'outputPer1MTokens') {
        (row[field] as number) = parseFloat(value) || 0;
      } else {
        (row[field] as string) = value;
      }
      row.updatedAt = nowIso();
      next[idx] = row;
      return next;
    });
    setSaved(false);
  }

  function addRow(): void {
    setRows((prev) => [
      ...prev,
      {
        modelId: '',
        inputPer1MTokens: 0,
        outputPer1MTokens: 0,
        updatedAt: nowIso(),
      },
    ]);
    setSaved(false);
  }

  async function handleSave(): Promise<void> {
    if (!totpToken) {
      setSaveError('Enter your TOTP code to save.');
      return;
    }
    setSaving(true);
    setSaveError(undefined);

    try {
      const r = await fetch(basePath + '/api/costs/price-table', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': totpToken,
        },
        body: JSON.stringify(rows),
      });
      if (r.status === 403) {
        setSaveError('Invalid or expired TOTP code.');
        return;
      }
      if (!r.ok) {
        const body = (await r.json()) as { error?: string };
        setSaveError(body.error ?? `HTTP ${r.status}`);
        return;
      }
      setSaved(true);
      setTotpToken('');
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="h-40 animate-pulse" style={{ background: 'var(--ae-raised)', border: '1px solid var(--ae-border)' }} />;
  if (error) return <p className="text-[11px]" style={{ color: 'var(--ae-red)' }}>Failed to load price table: {error}</p>;

  return (
    <div className="space-y-4">
      <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>
        Used as fallback when OpenRouter data is unavailable. Prices are USD per 1M tokens.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ae-border)' }}>
              {['Model ID', 'Input $/1M', 'Output $/1M', 'Last Updated'].map((h, i) => (
                <th
                  key={h}
                  className={`pb-2 pr-3 font-normal text-[10px] uppercase tracking-[0.10em]${i >= 1 ? ' text-right' : ' text-left'}`}
                  style={{ color: 'var(--ae-text3)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid var(--ae-border)' }}>
                <td className="py-1.5 pr-3">
                  <input
                    type="text"
                    value={row.modelId}
                    onChange={(e) => updateRow(idx, 'modelId', e.target.value)}
                    className="w-full"
                    style={inputStyle}
                    onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
                    onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
                  />
                </td>
                <td className="py-1.5 pr-3">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.inputPer1MTokens}
                    onChange={(e) => updateRow(idx, 'inputPer1MTokens', e.target.value)}
                    className="w-24 text-right"
                    style={inputStyle}
                    onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
                    onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
                  />
                </td>
                <td className="py-1.5 pr-3">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.outputPer1MTokens}
                    onChange={(e) => updateRow(idx, 'outputPer1MTokens', e.target.value)}
                    className="w-24 text-right"
                    style={inputStyle}
                    onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
                    onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
                  />
                </td>
                <td className="py-1.5 text-right text-[11px]" style={{ color: 'var(--ae-text2)' }}>
                  {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={addRow}
        className="text-[11px] hover:underline"
        style={{ color: 'var(--ae-cyan)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        + Add row
      </button>

      <div className="flex items-center gap-3" style={{ borderTop: '1px solid var(--ae-border)', paddingTop: '1rem' }}>
        <input
          type="text"
          inputMode="numeric"
          placeholder="TOTP"
          value={totpToken}
          onChange={(e) => {
            setTotpToken(e.target.value);
            setSaveError(undefined);
          }}
          maxLength={6}
          className="w-[100px] text-center"
          style={inputStyle}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
        />
        <button
          onClick={() => { void handleSave(); }}
          disabled={saving}
          className="text-[10px] uppercase tracking-[0.08em] disabled:opacity-50"
          style={{
            padding: '5px 12px',
            background: 'var(--ae-amber)',
            color: 'var(--ae-void)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-[11px]" style={{ color: 'var(--ae-green)' }}>Saved.</span>}
        {saveError && <span className="text-[11px]" style={{ color: 'var(--ae-red)' }}>{saveError}</span>}
      </div>
    </div>
  );
}
