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

  if (loading) return <div className="h-48 animate-pulse rounded bg-[#1e1e2e]" />;
  if (error) return <p className="text-sm text-red-400">Failed to load sessions: {error}</p>;
  if (!data || data.items.length === 0) {
    return <p className="text-sm text-[#6b7280]">No sessions found.</p>;
  }

  const totalPages = Math.ceil(data.total / limit);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#1e1e2e] text-left text-[#6b7280]">
              <th className="pb-2 pr-3">Timestamp</th>
              <th className="pb-2 pr-3">Agent</th>
              <th className="pb-2 pr-3">Model</th>
              <th className="pb-2 pr-3 text-right">In Tokens</th>
              <th className="pb-2 pr-3 text-right">Out Tokens</th>
              <th className="pb-2 pr-3 text-right">Cost</th>
              <th className="pb-2 pr-3 text-right">Duration</th>
              <th className="pb-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((session) => {
              const mean = data.agentMeanCost[session.agentId] ?? 0;
              const outlier = isOutlier(session, mean);
              return (
                <tr
                  key={session.sessionId}
                  className={`border-b border-[#1e1e2e]/50 ${
                    outlier ? 'bg-amber-950/20' : ''
                  }`}
                >
                  <td className="py-1.5 pr-3 text-[#9ca3af]">{formatTs(session.startedAt)}</td>
                  <td className="py-1.5 pr-3 font-mono text-[#c9d1d9]">{session.agentId}</td>
                  <td className="py-1.5 pr-3 text-[#9ca3af]">{shortModel(session.modelId)}</td>
                  <td className="py-1.5 pr-3 text-right text-[#9ca3af]">
                    {tokens(session.inputTokens)}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[#9ca3af]">
                    {tokens(session.outputTokens)}
                  </td>
                  <td
                    className={`py-1.5 pr-3 text-right font-medium ${
                      outlier ? 'text-amber-400' : 'text-white'
                    }`}
                  >
                    {usd(session.costUsd)}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[#9ca3af]">
                    {formatDuration(session.durationMs)}
                  </td>
                  <td className="py-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        session.source === 'openrouter'
                          ? 'bg-indigo-900/40 text-indigo-300'
                          : 'bg-[#1e1e2e] text-[#6b7280]'
                      }`}
                    >
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
        <div className="flex items-center justify-between text-xs text-[#6b7280]">
          <span>
            {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border border-[#1e1e2e] px-2 py-1 disabled:opacity-40 hover:bg-[#1e1e2e]"
            >
              ←
            </button>
            <span className="px-1">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-[#1e1e2e] px-2 py-1 disabled:opacity-40 hover:bg-[#1e1e2e]"
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
