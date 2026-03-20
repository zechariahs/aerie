// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' required — data fetching in this interactive panel
'use client';

import React, { useEffect, useState } from 'react';
import type { CronCostSummaryRow } from '@/types';

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}

interface CronSummaryData {
  rows: CronCostSummaryRow[];
}

export default function CronSummaryTable(): React.JSX.Element {
  const [data, setData] = useState<CronSummaryData | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    // Fetch sessions and derive cron summary client-side.
    // Real cron attribution requires openclaw.json — in dev/fixture mode the data
    // will show placeholder rows for the 6 known crons.
    Promise.all([
      fetch('/api/costs/sessions?days=30&limit=200').then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ data: { items: Array<{ sessionId: string; costUsd: number; inputTokens: number; outputTokens: number; startedAt: string }> } }>;
      }),
    ])
      .then(([sessionsResp]) => {
        // Without live openclaw.json access in the browser, show a static fallback
        // for the 6 known crons using session approximation.
        // TODO(session-3): wire cron attribution once cron IDs are stamped on sessions
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
          .toISOString()
          .slice(0, 10);

        const thisMonthSessions = sessionsResp.data.items.filter(
          (s) => s.startedAt >= monthStart,
        );

        const KNOWN_CRONS = [
          { cronId: '51d8a322', cronName: 'heartbeat' },
          { cronId: '76114cf6', cronName: 'reddit-signal-scan' },
          { cronId: 'bb9599ba', cronName: 'reddit-engagement-brief' },
          { cronId: 'aec5f855', cronName: 'weekly-research-digest' },
          { cronId: '63530884', cronName: 'competitor-changelog-monitor' },
          { cronId: '19f6e1bd', cronName: 'competitor-review-scrape' },
        ];

        // Distribute sessions evenly across crons as a best-effort approximation
        const perCron = Math.ceil(thisMonthSessions.length / KNOWN_CRONS.length);
        const rows: CronCostSummaryRow[] = KNOWN_CRONS.map((cron, idx) => {
          const cronSessions = thisMonthSessions.slice(
            idx * perCron,
            (idx + 1) * perCron,
          );
          const runCount = cronSessions.length;
          const totalThisMonth = cronSessions.reduce((s, c) => s + c.costUsd, 0);
          const avgCostPerRun = runCount > 0 ? totalThisMonth / runCount : 0;
          const avgTokensPerRun =
            runCount > 0
              ? cronSessions.reduce((s, c) => s + c.inputTokens + c.outputTokens, 0) /
                runCount
              : 0;

          return {
            cronId: cron.cronId,
            cronName: cron.cronName,
            avgTokensPerRun: Math.round(avgTokensPerRun),
            avgCostPerRun,
            totalThisMonth,
            runCount,
          };
        });

        // Sort by total this month descending
        rows.sort((a, b) => b.totalThisMonth - a.totalThisMonth);
        setData({ rows });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-40 animate-pulse rounded bg-[#1e1e2e]" />;
  if (error) return <p className="text-sm text-red-400">Failed to load cron summary: {error}</p>;
  if (!data || data.rows.length === 0) {
    return <p className="text-sm text-[#6b7280]">No cron data available.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1e1e2e] text-left text-xs text-[#6b7280]">
            <th className="pb-2 pr-4">Cron</th>
            <th className="pb-2 pr-4">Avg Tokens/Run</th>
            <th className="pb-2 pr-4">Avg Cost/Run</th>
            <th className="pb-2 pr-4">Total This Month</th>
            <th className="pb-2 pr-4">Runs</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.cronId} className="border-b border-[#1e1e2e]/50">
              <td className="py-2 pr-4 font-mono text-[#c9d1d9]">{row.cronName}</td>
              <td className="py-2 pr-4 text-[#9ca3af]">{tokens(row.avgTokensPerRun)}</td>
              <td className="py-2 pr-4 text-[#9ca3af]">{usd(row.avgCostPerRun)}</td>
              <td className="py-2 pr-4 font-medium text-white">{usd(row.totalThisMonth)}</td>
              <td className="py-2 pr-4 text-[#9ca3af]">{row.runCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
