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
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import type { DailyAgentCost } from '@/types';
import { basePath } from '@/lib/client-url';

// Amber palette — assigned round-robin per model, no purple
const MODEL_PALETTE = ['#C8890A', '#5C3E04', '#E0A018', '#281C02'];

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
    fetch(`${basePath}/api/costs/daily?days=${days}`)
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
    return (
      <div
        className="h-56 animate-pulse"
        style={{ background: 'var(--ae-raised)', border: '1px solid var(--ae-border)' }}
      />
    );
  }

  if (error) {
    return <p className="text-[11px]" style={{ color: 'var(--ae-red)' }}>Failed to load daily spend: {error}</p>;
  }

  if (data.length === 0) {
    return <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>No cost data available.</p>;
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
    <div>
      {/* Legend — mono text labels, no color swatches */}
      {modelIds.length > 1 && (
        <div className="flex flex-wrap gap-3 mb-3">
          {modelIds.map((id, i) => (
            <span key={id} className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--ae-text2)' }}>
              <span
                className="inline-block w-2 h-2 shrink-0"
                style={{ background: MODEL_PALETTE[i % MODEL_PALETTE.length] }}
              />
              {shortModel(id)}
            </span>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={224}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid
            vertical={false}
            stroke="#281C02"
            strokeWidth={1}
          />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: '#363430', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v: number) => `$${v.toFixed(3)}`}
            tick={{ fill: '#363430', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            width={58}
          />
          <Tooltip
            contentStyle={{
              background: '#0C0E0B',
              border: '1px solid #1C201A',
              borderRadius: 0,
              fontSize: 11,
              fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
            }}
            labelStyle={{ color: '#C8C4B0' }}
            itemStyle={{ color: '#686858' }}
            formatter={(value: number, name: string) => [
              formatUsd(value),
              shortModel(name),
            ]}
          />
          {modelIds.map((modelId, i) => (
            <Bar
              key={modelId}
              dataKey={modelId}
              stackId="cost"
              fill={MODEL_PALETTE[i % MODEL_PALETTE.length]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
