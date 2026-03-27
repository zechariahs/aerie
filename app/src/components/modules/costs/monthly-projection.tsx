// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' required — data fetching hook
'use client';

import React, { useEffect, useState } from 'react';
import type { CostSummary } from '@/types';
import { basePath } from '@/lib/client-url';

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function MonthlyProjection(): React.JSX.Element {
  const [data, setData] = useState<CostSummary | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    fetch(basePath + '/api/costs/summary')
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

  if (loading) {
    return (
      <div
        className="h-24 animate-pulse"
        style={{ background: 'var(--ae-raised)', border: '1px solid var(--ae-border)' }}
      />
    );
  }
  if (error) {
    return <p className="text-[11px]" style={{ color: 'var(--ae-red)' }}>Failed to load summary: {error}</p>;
  }
  if (!data) {
    return <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>No data.</p>;
  }

  const vsSign = data.vsLastMonthPct !== undefined && data.vsLastMonthPct >= 0 ? '+' : '';
  const vsColor: React.CSSProperties =
    data.vsLastMonthPct === undefined
      ? { color: 'var(--ae-text2)' }
      : data.vsLastMonthPct > 10
        ? { color: 'var(--ae-red)' }
        : data.vsLastMonthPct < -5
          ? { color: 'var(--ae-green)' }
          : { color: 'var(--ae-text)' };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
        valueStyle={vsColor}
      />
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  highlight?: boolean;
  valueStyle?: React.CSSProperties;
}

function Stat({ label, value, highlight, valueStyle }: StatProps): React.JSX.Element {
  return (
    <div
      className="p-3"
      style={{ background: 'var(--ae-raised)', border: '1px solid var(--ae-border)' }}
    >
      <p className="mb-1 text-[10px] uppercase tracking-[0.10em]" style={{ color: 'var(--ae-text2)' }}>
        {label}
      </p>
      <p
        className="text-[14px] font-[500] tabular-nums"
        style={highlight ? { color: 'var(--ae-amber)' } : (valueStyle ?? { color: 'var(--ae-text)' })}
      >
        {value}
      </p>
    </div>
  );
}
