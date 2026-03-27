// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' required — data fetching in this interactive panel
'use client';

import React, { useEffect, useState } from 'react';
import type { CronCostSummaryRow } from '@/types';
import { basePath } from '@/lib/client-url';

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
    fetch(basePath + '/api/costs/crons?days=30')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ data: CronCostSummaryRow[] }>;
      })
      .then((resp) => {
        setData({ rows: resp.data });
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
