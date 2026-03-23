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

  if (loading) return <div className="h-40 animate-pulse rounded bg-[#1e1e2e]" />;
  if (error) return <p className="text-sm text-red-400">Failed to load price table: {error}</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[#6b7280]">
        Used as fallback when OpenRouter data is unavailable. Prices are USD per 1M tokens.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1e1e2e] text-left text-xs text-[#6b7280]">
              <th className="pb-2 pr-3">Model ID</th>
              <th className="pb-2 pr-3 text-right">Input $/1M</th>
              <th className="pb-2 pr-3 text-right">Output $/1M</th>
              <th className="pb-2 text-right">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b border-[#1e1e2e]/50">
                <td className="py-1.5 pr-3">
                  <input
                    type="text"
                    value={row.modelId}
                    onChange={(e) => updateRow(idx, 'modelId', e.target.value)}
                    className="w-full rounded border border-[#1e1e2e] bg-[#12121a] px-2 py-1 font-mono text-xs text-[#c9d1d9] focus:border-[#6366f1] focus:outline-none"
                  />
                </td>
                <td className="py-1.5 pr-3">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.inputPer1MTokens}
                    onChange={(e) => updateRow(idx, 'inputPer1MTokens', e.target.value)}
                    className="w-24 rounded border border-[#1e1e2e] bg-[#12121a] px-2 py-1 text-right text-xs text-[#c9d1d9] focus:border-[#6366f1] focus:outline-none"
                  />
                </td>
                <td className="py-1.5 pr-3">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.outputPer1MTokens}
                    onChange={(e) => updateRow(idx, 'outputPer1MTokens', e.target.value)}
                    className="w-24 rounded border border-[#1e1e2e] bg-[#12121a] px-2 py-1 text-right text-xs text-[#c9d1d9] focus:border-[#6366f1] focus:outline-none"
                  />
                </td>
                <td className="py-1.5 text-right text-xs text-[#6b7280]">
                  {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={addRow}
        className="text-xs text-[#6366f1] hover:text-indigo-300 hover:underline"
      >
        + Add row
      </button>

      <div className="flex items-center gap-3 border-t border-[#1e1e2e] pt-4">
        <input
          type="text"
          inputMode="numeric"
          placeholder="TOTP code"
          value={totpToken}
          onChange={(e) => {
            setTotpToken(e.target.value);
            setSaveError(undefined);
          }}
          maxLength={6}
          className="w-28 rounded border border-[#1e1e2e] bg-[#12121a] px-2 py-1.5 text-center font-mono text-sm text-[#c9d1d9] focus:border-[#6366f1] focus:outline-none"
        />
        <button
          onClick={() => { void handleSave(); }}
          disabled={saving}
          className="rounded bg-[#6366f1] px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs text-green-400">Saved.</span>}
        {saveError && <span className="text-xs text-red-400">{saveError}</span>}
      </div>
    </div>
  );
}
