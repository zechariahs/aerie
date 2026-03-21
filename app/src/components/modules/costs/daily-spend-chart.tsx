// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' required — Recharts uses browser APIs
'use client';

import React, { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { DailyAgentCost } from '@/types';

const MODEL_COLORS: Record<string, string> = {
  'openrouter/moonshotai/kimi-k2-0905': '#6366f1',
  'openrouter/anthropic/claude-haiku-4-5': '#22d3ee',
  'openrouter/anthropic/claude-sonnet-4-5': '#f59e0b',
};

const DEFAULT_COLOR = '#8b5cf6';

interface ChartRow {
  date: string;
  [modelId: string]: number | string;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${m}/${d}`;
}

function shortModel(id: string): string {
  const parts = id.split('/');
  return parts[parts.length - 1] ?? id;
}

function formatUsd(v: number): string {
  return v >= 0.01 ? `$${v.toFixed(3)}` : `$${v.toFixed(5)}`;
}

interface DailySpendChartProps {
  days?: number;
}

export default function DailySpendChart({ days = 30 }: DailySpendChartProps): React.JSX.Element {
  const [data, setData] = useState<DailyAgentCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setLoading(true);
    setError(undefined);
    fetch(`/api/costs/daily?days=${days}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as { data: DailyAgentCost[] };
        setData(json.data);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return <div className="h-56 animate-pulse rounded bg-[#1e1e2e]" />;
  }

  if (error) {
    return (
      <p className="text-sm text-red-400">Failed to load daily spend: {error}</p>
    );
  }

  if (data.length === 0) {
    return <p className="text-sm text-[#6b7280]">No cost data available.</p>;
  }

  // Pivot data: one row per date, columns per model
  const modelIds = [...new Set(data.map((d) => d.modelId))];
  const dateMap = new Map<string, ChartRow>();

  for (const entry of data) {
    const existing = dateMap.get(entry.date) ?? { date: entry.date };
    const current = (existing[entry.modelId] as number | undefined) ?? 0;
    existing[entry.modelId] = current + entry.costUsd;
    dateMap.set(entry.date, existing);
  }

  const chartData = [...dateMap.values()].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );

  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={{ fill: '#6b7280', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(v: number) => `$${v.toFixed(3)}`}
          tick={{ fill: '#6b7280', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={58}
        />
        <Tooltip
          contentStyle={{
            background: '#12121a',
            border: '1px solid #1e1e2e',
            borderRadius: 6,
            fontSize: 12,
          }}
          labelStyle={{ color: '#c9d1d9' }}
          formatter={(value: number, name: string) => [
            formatUsd(value),
            shortModel(name),
          ]}
        />
        <Legend
          formatter={shortModel}
          wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
        />
        {modelIds.map((modelId) => (
          <Bar
            key={modelId}
            dataKey={modelId}
            stackId="cost"
            fill={MODEL_COLORS[modelId] ?? DEFAULT_COLOR}
            radius={modelId === modelIds[modelIds.length - 1] ? [2, 2, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
