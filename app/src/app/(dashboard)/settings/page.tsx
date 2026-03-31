// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TotpDialog } from '@/components/modules/tasks/totp-dialog';
import { basePath } from '@/lib/client-url';

const inputStyle: React.CSSProperties = {
  background: 'var(--ae-raised)',
  border: '1px solid var(--ae-border)',
  color: 'var(--ae-text)',
  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  fontSize: 11,
  padding: '4px 6px',
  outline: 'none',
  width: '100%',
};

const focusAmber = (e: React.FocusEvent<HTMLInputElement>) => {
  (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)';
};
const blurBorder = (e: React.FocusEvent<HTMLInputElement>) => {
  (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)';
};

export default function SettingsPage(): React.JSX.Element {
  // Active Hours state
  const [activeStart, setActiveStart] = useState('07:00');
  const [activeEnd, setActiveEnd] = useState('21:00');
  const [timezone, setTimezone] = useState('UTC');

  // Model Tiers state
  const [fastModel, setFastModel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [reasoningModel, setReasoningModel] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // TOTP dialog state
  const [totpOpen, setTotpOpen] = useState(false);
  const pendingActionRef = useRef<((token: string) => void) | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [settingsRes, tiersRes] = await Promise.all([
        fetch(`${basePath}/api/settings`),
        fetch(`${basePath}/api/tasks/model-tiers`),
      ]);

      if (!settingsRes.ok || !tiersRes.ok) {
        setError('Failed to load settings');
        return;
      }

      const settingsJson = (await settingsRes.json()) as { data: Record<string, string> };
      const tiersJson = (await tiersRes.json()) as { data: { fast?: string; default?: string; reasoning?: string } };

      const s = settingsJson.data;
      setActiveStart(s['AGENT_ACTIVE_START'] ?? '07:00');
      setActiveEnd(s['AGENT_ACTIVE_END'] ?? '21:00');
      setTimezone(s['AGENT_TIMEZONE'] ?? 'UTC');

      const t = tiersJson.data;
      setFastModel(t.fast ?? '');
      setDefaultModel(t.default ?? '');
      setReasoningModel(t.reasoning ?? '');
    } catch {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  function requestTotp(action: (token: string) => void): void {
    pendingActionRef.current = action;
    setTotpOpen(true);
  }

  function onTotpConfirm(token: string): void {
    setTotpOpen(false);
    if (pendingActionRef.current) {
      pendingActionRef.current(token);
      pendingActionRef.current = undefined;
    }
  }

  function onTotpCancel(): void {
    setTotpOpen(false);
    pendingActionRef.current = undefined;
  }

  async function saveActiveHours(token: string): Promise<void> {
    try {
      const res = await fetch(`${basePath}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-TOTP-Token': token },
        body: JSON.stringify({
          AGENT_ACTIVE_START: activeStart,
          AGENT_ACTIVE_END: activeEnd,
          AGENT_TIMEZONE: timezone,
        }),
      });
      if (res.ok) {
        showToast('Active hours saved');
      } else {
        let msg = 'Failed to save active hours';
        try { const err = (await res.json()) as { error?: string }; if (err.error) msg = `Error: ${err.error}`; } catch { /* ignore */ }
        showToast(msg);
      }
    } catch {
      showToast('Failed to save active hours');
    }
  }

  async function saveModelTiers(token: string): Promise<void> {
    try {
      const res = await fetch(`${basePath}/api/tasks/model-tiers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-TOTP-Token': token },
        body: JSON.stringify({
          fast: fastModel || null,
          default: defaultModel || null,
          reasoning: reasoningModel || null,
        }),
      });
      if (res.ok) {
        showToast('Model tiers saved');
      } else {
        let msg = 'Failed to save model tiers';
        try { const err = (await res.json()) as { error?: string }; if (err.error) msg = `Error: ${err.error}`; } catch { /* ignore */ }
        showToast(msg);
      }
    } catch {
      showToast('Failed to save model tiers');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-8 p-4">
      <div>
        <span className="ae-section-label">── Settings ─────────────</span>
      </div>

      {error && <p className="text-[11px]" style={{ color: 'var(--ae-red)' }}>{error}</p>}

      {toast && (
        <div className="px-3 py-1.5 text-[11px]" style={{ background: 'var(--ae-raised)', border: '1px solid var(--ae-border)', color: 'var(--ae-text)' }}>
          {toast}
        </div>
      )}

      {/* Active Hours */}
      <div className="space-y-3">
        <span className="ae-section-label">── Active Hours ─────────</span>

        <div>
          <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Active Start</label>
          <input
            type="text"
            value={activeStart}
            onChange={(e) => setActiveStart(e.target.value)}
            placeholder="07:00"
            style={inputStyle}
            onFocus={focusAmber}
            onBlur={blurBorder}
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Active End</label>
          <input
            type="text"
            value={activeEnd}
            onChange={(e) => setActiveEnd(e.target.value)}
            placeholder="21:00"
            style={inputStyle}
            onFocus={focusAmber}
            onBlur={blurBorder}
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Timezone (IANA)</label>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="UTC"
            style={inputStyle}
            onFocus={focusAmber}
            onBlur={blurBorder}
          />
        </div>

        <button
          onClick={() => requestTotp((token) => { void saveActiveHours(token); })}
          className="text-[10px] uppercase tracking-[0.08em]"
          style={{
            padding: '5px 12px',
            background: 'var(--ae-amber)',
            border: 'none',
            color: 'var(--ae-void)',
          }}
        >
          Save Active Hours
        </button>
      </div>

      {/* Model Tiers */}
      <div className="space-y-3">
        <span className="ae-section-label">── Model Tiers ──────────</span>

        <div>
          <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Fast Model ID</label>
          <input
            type="text"
            value={fastModel}
            onChange={(e) => setFastModel(e.target.value)}
            placeholder="e.g. claude-haiku-4-5-20251001"
            style={inputStyle}
            onFocus={focusAmber}
            onBlur={blurBorder}
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Default Model ID</label>
          <input
            type="text"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder="e.g. claude-sonnet-4-6"
            style={inputStyle}
            onFocus={focusAmber}
            onBlur={blurBorder}
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Reasoning Model ID</label>
          <input
            type="text"
            value={reasoningModel}
            onChange={(e) => setReasoningModel(e.target.value)}
            placeholder="e.g. claude-opus-4-6"
            style={inputStyle}
            onFocus={focusAmber}
            onBlur={blurBorder}
          />
        </div>

        <button
          onClick={() => requestTotp((token) => { void saveModelTiers(token); })}
          className="text-[10px] uppercase tracking-[0.08em]"
          style={{
            padding: '5px 12px',
            background: 'var(--ae-amber)',
            border: 'none',
            color: 'var(--ae-void)',
          }}
        >
          Save Model Tiers
        </button>
      </div>

      {totpOpen && (
        <TotpDialog
          title="Confirm Action"
          description="Enter your TOTP code to continue."
          onConfirm={onTotpConfirm}
          onCancel={onTotpCancel}
        />
      )}
    </div>
  );
}
