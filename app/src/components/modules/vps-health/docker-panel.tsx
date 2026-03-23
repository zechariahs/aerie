// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Polls for live container data and manages TOTP restart flow

import { useEffect, useRef, useState } from 'react';
import type { DockerContainer, DockerList } from '@/types/index';
import { basePath } from '@/lib/client-url';

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
      <p className="text-sm text-[#6b7280]">
        Host agent unavailable — is host-agent running on the VPS host?
      </p>
      <button
        onClick={onRetry}
        className="text-xs px-3 py-1.5 rounded border border-[#1e1e2e] text-[#6b7280] hover:text-white hover:border-[#6366f1] transition-colors"
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
    if (!restart.totpInput.trim()) {
      setRestart((r) => ({ ...r, error: 'TOTP code required' }));
      return;
    }
    setRestart((r) => ({ ...r, pending: true, error: undefined }));
    try {
      const res = await fetch(basePath + '/api/vps/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TOTP-Token': restart.totpInput.trim() },
        body: JSON.stringify({ container: OPENCLAW_CONTAINER }),
      });
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
    return <div className="py-8 text-center text-xs text-[#6b7280] animate-pulse">Loading containers…</div>;
  }

  if (state.error) {
    return <DockerUnavailable onRetry={handleRetry} />;
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[#6b7280] border-b border-[#1e1e2e]">
              <th className="text-left pb-2 pr-4 font-medium">Container</th>
              <th className="text-left pb-2 pr-4 font-medium">Status</th>
              <th className="text-right pb-2 pr-4 font-medium">CPU %</th>
              <th className="text-right pb-2 pr-4 font-medium">Mem MB</th>
              <th className="text-right pb-2 font-medium">Uptime</th>
            </tr>
          </thead>
          <tbody>
            {state.containers.map((c) => {
              const isOc = c.name === OPENCLAW_CONTAINER;
              return (
                <tr
                  key={c.name}
                  className={[
                    'border-b border-[#1e1e2e]/50',
                    isOc ? 'text-[#a5b4fc]' : 'text-[#e2e8f0]',
                  ].join(' ')}
                >
                  <td className="py-2 pr-4 font-mono">{c.name}</td>
                  <td className="py-2 pr-4">
                    <span className={[
                      'px-1.5 py-0.5 rounded text-[10px]',
                      c.status === 'running' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400',
                    ].join(' ')}>
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right">{c.cpuPct.toFixed(1)}%</td>
                  <td className="py-2 pr-4 text-right">{c.memMb.toFixed(0)}</td>
                  <td className="py-2 text-right">{formatUptime(c.uptimeSeconds)}</td>
                </tr>
              );
            })}
            {state.containers.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-[#6b7280]">No running containers</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Restart panel for openclaw container */}
      <div className="pt-2 border-t border-[#1e1e2e]">
        <p className="text-xs text-[#6b7280] mb-2">Restart {OPENCLAW_CONTAINER}</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="TOTP code"
            value={restart.totpInput}
            onChange={(e) => setRestart((r) => ({ ...r, totpInput: e.target.value, error: undefined }))}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleRestart(); }}
            className="w-28 px-2 py-1 rounded border border-[#1e1e2e] bg-[#0a0a0f] text-[#e2e8f0] text-xs placeholder:text-[#6b7280] focus:outline-none focus:border-[#6366f1]"
            disabled={restart.pending}
            maxLength={6}
          />
          <button
            onClick={() => void handleRestart()}
            disabled={restart.pending}
            className="px-3 py-1 text-xs rounded border border-[#1e1e2e] text-[#6b7280] hover:text-white hover:border-red-500 transition-colors disabled:opacity-40"
          >
            {restart.pending ? 'Restarting…' : 'Restart'}
          </button>
          {restart.success && <span className="text-xs text-green-400">Restarted</span>}
          {restart.error && <span className="text-xs text-red-400">{restart.error}</span>}
        </div>
      </div>
    </div>
  );
}
