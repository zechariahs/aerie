// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Polls for live container data and manages TOTP restart flow

import { useEffect, useRef, useState } from 'react';
import type { DockerContainer, DockerList } from '@/types/index';
import { basePath } from '@/lib/client-url';
import { isTotpFresh, clearTotpFreshCookieClient } from '@/lib/totp-fresh';

// Highlighted in brand color — the configured openclaw container name
const OPENCLAW_CONTAINER = process.env['NEXT_PUBLIC_OPENCLAW_CONTAINER'] ?? 'openclaw';

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface RestartState {
  pending: boolean;
  totpInput: string;
  error: string | undefined;
  success: boolean;
}

interface DockerPanelState {
  containers: DockerContainer[];
  error: string | undefined;
  loading: boolean;
}

/** Unavailable state — reused from parent page too. */
export function DockerUnavailable({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>
        Host agent unavailable — is host-agent running on the VPS host?
      </p>
      <button
        onClick={onRetry}
        className="text-[10px] uppercase tracking-[0.08em]"
        style={{
          padding: '4px 10px',
          background: 'transparent',
          border: '1px solid var(--ae-border-hi)',
          color: 'var(--ae-text2)',
        }}
      >
        Retry
      </button>
    </div>
  );
}

export function DockerPanel(): React.JSX.Element {
  const [state, setState] = useState<DockerPanelState>({ containers: [], error: undefined, loading: true });
  const [restart, setRestart] = useState<RestartState>({ pending: false, totpInput: '', error: undefined, success: false });
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  async function fetchDocker(): Promise<void> {
    try {
      const res = await fetch(basePath + '/api/vps/docker');
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch containers' })) as { error?: string };
        setState({ containers: [], error: err.error ?? 'Failed to fetch containers', loading: false });
        return;
      }
      const json = await res.json() as { data: DockerList };
      setState({ containers: json.data.containers, error: undefined, loading: false });
    } catch {
      setState({ containers: [], error: 'Host agent unavailable', loading: false });
    }
  }

  function startPolling(): void {
    void fetchDocker();
    intervalRef.current = setInterval(() => { void fetchDocker(); }, 15000);
  }

  function stopPolling(): void {
    if (intervalRef.current !== undefined) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
  }

  useEffect(() => {
    startPolling();
    return stopPolling;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRetry(): void {
    setState({ containers: [], error: undefined, loading: true });
    stopPolling();
    startPolling();
  }

  async function handleRestart(): Promise<void> {
    const fresh = isTotpFresh();
    if (!fresh && !restart.totpInput.trim()) {
      setRestart((r) => ({ ...r, error: 'TOTP code required' }));
      return;
    }
    setRestart((r) => ({ ...r, pending: true, error: undefined }));
    try {
      const res = await fetch(basePath + '/api/vps/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TOTP-Token': fresh ? '' : restart.totpInput.trim() },
        body: JSON.stringify({ container: OPENCLAW_CONTAINER }),
      });
      if (res.status === 403) {
        if (fresh) {
          // Empty token sent — server grace period reset. Clear cookie so the
          // next attempt sends the entered TOTP token rather than sending empty.
          clearTotpFreshCookieClient();
          setRestart((r) => ({ ...r, pending: false, error: 'Session expired — enter TOTP code' }));
        } else {
          setRestart((r) => ({ ...r, pending: false, error: 'Invalid or expired TOTP code' }));
        }
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Restart failed' })) as { error?: string };
        setRestart((r) => ({ ...r, pending: false, error: err.error ?? 'Restart failed' }));
        return;
      }
      setRestart({ pending: false, totpInput: '', error: undefined, success: true });
      // Refresh container list after restart
      setTimeout(() => { void fetchDocker(); }, 3000);
      setTimeout(() => setRestart((r) => ({ ...r, success: false })), 5000);
    } catch {
      setRestart((r) => ({ ...r, pending: false, error: 'Network error' }));
    }
  }

  if (state.loading) {
    return <div className="py-8 text-center text-[11px] animate-pulse" style={{ color: 'var(--ae-text2)' }}>Loading containers…</div>;
  }

  if (state.error) {
    return <DockerUnavailable onRetry={handleRetry} />;
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ae-border)' }}>
              {['Container', 'Status', 'CPU %', 'Mem MB', 'Uptime'].map((h, i) => (
                <th
                  key={h}
                  className={`pb-2 pr-4 font-normal text-[10px] uppercase tracking-[0.10em]${i >= 2 ? ' text-right' : ' text-left'}`}
                  style={{ color: 'var(--ae-text3)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.containers.map((c) => {
              const isOc = c.name === OPENCLAW_CONTAINER;
              return (
                <tr
                  key={c.name}
                  style={{ borderBottom: '1px solid var(--ae-border)', color: isOc ? 'var(--ae-amber)' : 'var(--ae-text)' }}
                >
                  <td className="py-2 pr-4 text-[11px]">{c.name}</td>
                  <td className="py-2 pr-4">
                    <span className={c.status === 'running' ? 'ae-badge ae-badge-ok' : 'ae-badge ae-badge-error'}>
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right text-[11px]">{c.cpuPct.toFixed(1)}%</td>
                  <td className="py-2 pr-4 text-right text-[11px]">{c.memMb.toFixed(0)}</td>
                  <td className="py-2 text-right text-[11px]">{formatUptime(c.uptimeSeconds)}</td>
                </tr>
              );
            })}
            {state.containers.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-[11px]" style={{ color: 'var(--ae-text2)' }}>No running containers</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Restart panel for openclaw container */}
      <div className="pt-2" style={{ borderTop: '1px solid var(--ae-border)' }}>
        <p className="text-[11px] mb-2" style={{ color: 'var(--ae-text2)' }}>Restart {OPENCLAW_CONTAINER}</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="TOTP code"
            value={restart.totpInput}
            onChange={(e) => setRestart((r) => ({ ...r, totpInput: e.target.value, error: undefined }))}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleRestart(); }}
            style={{
              width: 100,
              padding: '3px 6px',
              background: 'var(--ae-raised)',
              border: '1px solid var(--ae-border)',
              color: 'var(--ae-text)',
              fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
              fontSize: 11,
              outline: 'none',
            }}
            disabled={restart.pending}
            maxLength={6}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
          />
          <button
            onClick={() => void handleRestart()}
            disabled={restart.pending}
            className="text-[10px] uppercase tracking-[0.08em] disabled:opacity-40"
            style={{
              padding: '4px 10px',
              background: 'transparent',
              border: '1px solid var(--ae-red-dim)',
              color: 'var(--ae-red)',
            }}
          >
            {restart.pending ? 'Restarting…' : 'Restart'}
          </button>
          {restart.success && <span className="text-[11px]" style={{ color: 'var(--ae-green)' }}>Restarted</span>}
          {restart.error && <span className="text-[11px]" style={{ color: 'var(--ae-red)' }}>{restart.error}</span>}
        </div>
      </div>
    </div>
  );
}
