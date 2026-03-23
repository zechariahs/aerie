// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Polls every 5s, maintains sparkline state

import { useEffect, useRef, useState } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import type { VpsMetrics } from '@/types/index';
import { basePath } from '@/lib/client-url';

interface SparkSample {
  value: number;
}

interface PanelState {
  metrics: VpsMetrics | undefined;
  error: string | undefined;
  loading: boolean;
}

function formatBytes(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} KB/s`;
  return `${bps} B/s`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

interface BarProps {
  used: number;
  total: number;
  label: string;
}

function UsageBar({ used, total, label }: BarProps): React.JSX.Element {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const color = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#6366f1';
  return (
    <div>
      <div className="flex justify-between text-xs text-[#6b7280] mb-1">
        <span>{label}</span>
        <span className="text-[#e2e8f0]">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-[#1e1e2e] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

interface GaugeProps {
  value: number;
}

function CpuGauge({ value }: GaugeProps): React.JSX.Element {
  // Half-circle arc gauge using SVG paths
  const radius = 36;
  const sw = 7;
  const circumference = Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, value) / 100);
  const color = value > 85 ? '#ef4444' : value > 65 ? '#f59e0b' : '#6366f1';

  return (
    <svg width="88" height="52" viewBox="0 0 88 52" className="overflow-visible">
      <path
        d={`M ${sw} ${48} A ${radius} ${radius} 0 0 1 ${88 - sw} ${48}`}
        fill="none"
        stroke="#1e1e2e"
        strokeWidth={sw}
        strokeLinecap="round"
      />
      <path
        d={`M ${sw} ${48} A ${radius} ${radius} 0 0 1 ${88 - sw} ${48}`}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.5s ease' }}
      />
      <text x="44" y="44" textAnchor="middle" fill="#e2e8f0" fontSize="13" fontWeight="600">
        {value.toFixed(1)}%
      </text>
    </svg>
  );
}

/** Unavailable state card shown when the host agent cannot be reached. */
export function SystemMetricsUnavailable({ onRetry }: { onRetry: () => void }): React.JSX.Element {
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

export function SystemMetricsPanel(): React.JSX.Element {
  const [state, setState] = useState<PanelState>({ metrics: undefined, error: undefined, loading: true });
  const [sparkline, setSparkline] = useState<SparkSample[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  async function fetchMetrics(): Promise<void> {
    try {
      const res = await fetch(basePath + '/api/vps/metrics');
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch metrics' })) as { error?: string };
        setState({ metrics: undefined, error: err.error ?? 'Failed to fetch metrics', loading: false });
        return;
      }
      const json = await res.json() as { data: VpsMetrics };
      setState({ metrics: json.data, error: undefined, loading: false });
      setSparkline((prev) => {
        const next = [...prev, { value: json.data.cpuPct }];
        // Keep last 60 samples (5 min at 5s interval)
        return next.length > 60 ? next.slice(next.length - 60) : next;
      });
    } catch {
      setState({ metrics: undefined, error: 'Host agent unavailable', loading: false });
    }
  }

  function startPolling(): void {
    void fetchMetrics();
    intervalRef.current = setInterval(() => { void fetchMetrics(); }, 5000);
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
    setState({ metrics: undefined, error: undefined, loading: true });
    stopPolling();
    startPolling();
  }

  if (state.loading) {
    return <div className="py-8 text-center text-xs text-[#6b7280] animate-pulse">Loading metrics…</div>;
  }

  if (state.error) {
    return <SystemMetricsUnavailable onRetry={handleRetry} />;
  }

  const m = state.metrics!;

  return (
    <div className="space-y-5">
      {/* CPU */}
      <div>
        <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-2">CPU</p>
        <div className="flex items-end gap-4">
          <CpuGauge value={m.cpuPct} />
          <div className="flex-1 h-12">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkline} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#6366f1"
                  strokeWidth={1.5}
                  fill="#6366f1"
                  fillOpacity={0.1}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* RAM */}
      <UsageBar used={m.memUsedMb} total={m.memTotalMb} label={`RAM — ${m.memUsedMb} / ${m.memTotalMb} MB`} />

      {/* Disk */}
      <UsageBar used={m.diskUsedGb} total={m.diskTotalGb} label={`Disk — ${m.diskUsedGb} / ${m.diskTotalGb} GB`} />

      {/* Network */}
      <div>
        <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-2">Network</p>
        <div className="flex gap-4 text-sm">
          <span className="text-[#6b7280]">↓ <span className="text-[#e2e8f0]">{formatBytes(m.networkInBps)}</span></span>
          <span className="text-[#6b7280]">↑ <span className="text-[#e2e8f0]">{formatBytes(m.networkOutBps)}</span></span>
        </div>
      </div>

      {/* Load Average */}
      <div>
        <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-2">Load Average</p>
        <div className="flex gap-2">
          {[
            { label: '1m', value: m.loadAvg1m },
            { label: '5m', value: m.loadAvg5m },
            { label: '15m', value: m.loadAvg15m },
          ].map(({ label, value }) => (
            <span
              key={label}
              className="px-2 py-0.5 rounded text-xs border border-[#1e1e2e] text-[#e2e8f0]"
            >
              {label}: {value.toFixed(2)}
            </span>
          ))}
        </div>
      </div>

      {/* Uptime */}
      <div className="flex justify-between text-xs">
        <span className="text-[#6b7280]">Uptime</span>
        <span className="text-[#e2e8f0]">{formatUptime(m.uptimeSeconds)}</span>
      </div>
    </div>
  );
}

