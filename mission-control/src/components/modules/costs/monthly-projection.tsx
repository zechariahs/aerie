// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' required — data fetching hook
'use client';

import React, { useEffect, useState } from 'react';
import type { CostSummary } from '@/types';

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function MonthlyProjection(): React.JSX.Element {
  const [data, setData] = useState<CostSummary | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    fetch('/api/costs/summary')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as { data: CostSummary };
        setData(json.data);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-24 animate-pulse rounded bg-[#1e1e2e]" />;
  if (error) return <p className="text-sm text-red-400">Failed to load summary: {error}</p>;
  if (!data) return <p className="text-sm text-[#6b7280]">No data.</p>;

  const vsSign = data.vsLastMonthPct !== undefined && data.vsLastMonthPct >= 0 ? '+' : '';
  const vsColor =
    data.vsLastMonthPct === undefined
      ? 'text-[#6b7280]'
      : data.vsLastMonthPct > 10
        ? 'text-red-400'
        : data.vsLastMonthPct < -5
          ? 'text-green-400'
          : 'text-[#9ca3af]';

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Stat label="Today" value={usd(data.today)} />
      <Stat label="This Week" value={usd(data.thisWeek)} />
      <Stat label="This Month" value={usd(data.thisMonth)} />
      <Stat label="Projected Month-End" value={usd(data.projectedMonth)} highlight />
      <Stat
        label="vs. Last Month"
        value={
          data.vsLastMonthPct !== undefined
            ? `${vsSign}${data.vsLastMonthPct.toFixed(1)}%`
            : '—'
        }
        valueClass={vsColor}
      />
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  highlight?: boolean;
  valueClass?: string;
}

function Stat({ label, value, highlight, valueClass }: StatProps): React.JSX.Element {
  return (
    <div className="rounded border border-[#1e1e2e] bg-[#12121a] p-3">
      <p className="mb-1 text-xs text-[#6b7280]">{label}</p>
      <p
        className={`text-lg font-semibold tabular-nums ${
          highlight ? 'text-[#6366f1]' : (valueClass ?? 'text-white')
        }`}
      >
        {value}
      </p>
    </div>
  );
}
