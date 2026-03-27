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

  if (loading) return <div className="h-40 animate-pulse" style={{ background: 'var(--ae-raised)', border: '1px solid var(--ae-border)' }} />;
  if (error) return <p className="text-[11px]" style={{ color: 'var(--ae-red)' }}>Failed to load cron summary: {error}</p>;
  if (!data || data.rows.length === 0) {
    return <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>No cron data available.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--ae-border)' }}>
            {['Cron', 'Avg Tokens/Run', 'Avg Cost/Run', 'Total This Month', 'Runs'].map((h) => (
              <th
                key={h}
                className="pb-2 pr-4 text-left font-normal text-[10px] uppercase tracking-[0.10em]"
                style={{ color: 'var(--ae-text3)' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.cronId} style={{ borderBottom: '1px solid var(--ae-border)' }}>
              <td className="py-2 pr-4 text-[11px]" style={{ color: 'var(--ae-text)' }}>{row.cronName}</td>
              <td className="py-2 pr-4 text-[11px]" style={{ color: 'var(--ae-text2)' }}>{tokens(row.avgTokensPerRun)}</td>
              <td className="py-2 pr-4 text-[11px]" style={{ color: 'var(--ae-text2)' }}>{usd(row.avgCostPerRun)}</td>
              <td className="py-2 pr-4 text-[11px] font-medium" style={{ color: 'var(--ae-text)' }}>{usd(row.totalThisMonth)}</td>
              <td className="py-2 pr-4 text-[11px]" style={{ color: 'var(--ae-text2)' }}>{row.runCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
