// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' required — pagination + filter interactions
'use client';

import React, { useEffect, useState } from 'react';
import type { PaginatedSessionCosts, SessionCost } from '@/types';
import { basePath } from '@/lib/client-url';

function usd(n: number): string {
  return `$${n.toFixed(5)}`;
}

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: process.env['NEXT_PUBLIC_TIMEZONE'] ?? 'America/Chicago',
    });
  } catch {
    return iso;
  }
}

function shortModel(id: string): string {
  const parts = id.split('/');
  return parts[parts.length - 1] ?? id;
}

/** Returns true if the session cost is an outlier (> 2σ above agent mean). */
function isOutlier(session: SessionCost, agentMean: number): boolean {
  // Without individual σ we approximate: flag if cost > 3× the mean
  return agentMean > 0 && session.costUsd > agentMean * 3;
}

interface SessionInspectorProps {
  agentFilter: string | undefined;
}

export default function SessionInspector({ agentFilter }: SessionInspectorProps): React.JSX.Element {
  const [data, setData] = useState<PaginatedSessionCosts | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const limit = 50;

  useEffect(() => {
    setPage(1);
  }, [agentFilter]);

  useEffect(() => {
    setLoading(true);
    setError(undefined);

    const params = new URLSearchParams({
      days: '30',
      page: String(page),
      limit: String(limit),
    });
    if (agentFilter) params.set('agentId', agentFilter);

    fetch(`${basePath}/api/costs/sessions?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as { data: PaginatedSessionCosts };
        setData(json.data);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, [agentFilter, page]);

  if (loading) return <div className="h-48 animate-pulse" style={{ background: 'var(--ae-amber-faint)', border: '1px solid var(--ae-amber-dim)' }} />;
  if (error) return <p className="text-[11px]" style={{ color: 'var(--ae-red)' }}>Failed to load sessions: {error}</p>;
  if (!data || data.items.length === 0) {
    return <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>No sessions found.</p>;
  }

  const totalPages = Math.ceil(data.total / limit);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ae-border)' }}>
              {['Timestamp', 'Agent', 'Model', 'In Tokens', 'Out Tokens', 'Cost', 'Duration', 'Source'].map((h, i) => (
                <th
                  key={h}
                  className={`pb-2 pr-3 font-normal text-[10px] uppercase tracking-[0.10em]${i >= 3 && i <= 6 ? ' text-right' : ' text-left'}`}
                  style={{ color: 'var(--ae-text3)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((session) => {
              const mean = data.agentMeanCost[session.agentId] ?? 0;
              const outlier = isOutlier(session, mean);
              return (
                <tr
                  key={session.sessionId}
                  style={{
                    borderBottom: '1px solid var(--ae-border)',
                    background: outlier ? 'var(--ae-amber-faint)' : 'transparent',
                  }}
                >
                  <td className="py-1.5 pr-3 text-[11px]" style={{ color: 'var(--ae-text2)' }}>{formatTs(session.startedAt)}</td>
                  <td className="py-1.5 pr-3 text-[11px]" style={{ color: 'var(--ae-text)' }}>{session.agentId}</td>
                  <td className="py-1.5 pr-3 text-[11px]" style={{ color: 'var(--ae-text2)' }}>{shortModel(session.modelId)}</td>
                  <td className="py-1.5 pr-3 text-right text-[11px]" style={{ color: 'var(--ae-text2)' }}>
                    {tokens(session.inputTokens)}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[11px]" style={{ color: 'var(--ae-text2)' }}>
                    {tokens(session.outputTokens)}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[11px] font-medium" style={{ color: outlier ? 'var(--ae-amber)' : 'var(--ae-text)' }}>
                    {usd(session.costUsd)}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[11px]" style={{ color: 'var(--ae-text2)' }}>
                    {formatDuration(session.durationMs)}
                  </td>
                  <td className="py-1.5">
                    <span className={session.source === 'openrouter' ? 'ae-badge ae-badge-active' : 'ae-badge ae-badge-off'}>
                      {session.source === 'openrouter' ? 'OpenRouter' : 'Estimated'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--ae-text2)' }}>
          <span>
            {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="text-[10px] uppercase tracking-[0.08em] disabled:opacity-40"
              style={{
                padding: '4px 10px',
                background: 'transparent',
                border: '1px solid var(--ae-border-hi)',
                color: 'var(--ae-text2)',
              }}
            >
              ←
            </button>
            <span className="px-1 self-center">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="text-[10px] uppercase tracking-[0.08em] disabled:opacity-40"
              style={{
                padding: '4px 10px',
                background: 'transparent',
                border: '1px solid var(--ae-border-hi)',
                color: 'var(--ae-text2)',
              }}
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
