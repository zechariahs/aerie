// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' required — event handlers + Recharts sparklines
'use client';

import React, { useEffect, useState } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import type { DailyAgentCost, AgentCostSummaryRow } from '@/types';
import { basePath } from '@/lib/client-url';

function buildSummaryRows(daily: DailyAgentCost[]): AgentCostSummaryRow[] {
  const agentIds = [...new Set(daily.map((d) => d.agentId))];
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const weekDates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    weekDates.push(d.toISOString().slice(0, 10));
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  return agentIds.map((id) => {
    const agentDaily = daily.filter((d) => d.agentId === id);

    const today = agentDaily
      .filter((d) => d.date === todayStr)
      .reduce((sum, d) => sum + d.costUsd, 0);

    const thisWeek = agentDaily
      .filter((d) => weekDates.includes(d.date))
      .reduce((sum, d) => sum + d.costUsd, 0);

    const thisMonth = agentDaily
      .filter((d) => d.date >= monthStart)
      .reduce((sum, d) => sum + d.costUsd, 0);

    // Estimate sessions from daily entries (one entry per model per day ≈ multiple sessions)
    const sessionCount = agentDaily.length;
    const avgCostPerSession = sessionCount > 0 ? thisMonth / sessionCount : 0;

    const weeklySparkline = weekDates.map((date) =>
      agentDaily
        .filter((d) => d.date === date)
        .reduce((sum, d) => sum + d.costUsd, 0),
    );

    return { agentId: id, today, thisWeek, thisMonth, avgCostPerSession, sessionCount, weeklySparkline };
  });
}

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

interface AgentSummaryTableProps {
  onAgentFilter: (agentId: string | undefined) => void;
  activeAgent: string | undefined;
}

export default function AgentSummaryTable({
  onAgentFilter,
  activeAgent,
}: AgentSummaryTableProps): React.JSX.Element {
  const [rows, setRows] = useState<AgentCostSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    fetch(basePath + '/api/costs/daily?days=30')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as { data: DailyAgentCost[] };
        setRows(buildSummaryRows(json.data));
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
    return <p className="text-[11px]" style={{ color: 'var(--ae-red)' }}>Failed to load agent summary: {error}</p>;
  }
  if (rows.length === 0) {
    return <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>No agent data.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--ae-border)' }}>
            {['Agent', 'Today', 'This Week', 'This Month', 'Avg/Session', 'Sessions'].map((h) => (
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
          {rows.map((row) => (
            <tr
              key={row.agentId}
              onClick={() => onAgentFilter(activeAgent === row.agentId ? undefined : row.agentId)}
              className="cursor-pointer transition-colors"
              style={{
                borderBottom: '1px solid var(--ae-border)',
                background: activeAgent === row.agentId ? 'var(--ae-raised)' : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (activeAgent !== row.agentId)
                  (e.currentTarget as HTMLElement).style.background = 'var(--ae-surface)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  activeAgent === row.agentId ? 'var(--ae-raised)' : 'transparent';
              }}
            >
              <td className="py-2 pr-4 text-[11px]" style={{ color: 'var(--ae-text)' }}>{row.agentId}</td>
              <td className="py-2 pr-4 text-[11px]" style={{ color: 'var(--ae-text2)' }}>{usd(row.today)}</td>
              <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                  <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>{usd(row.thisWeek)}</span>
                  <span className="inline-block h-8 w-16">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={row.weeklySparkline.map((v, i) => ({ i, v }))}>
                        <Line
                          type="monotone"
                          dataKey="v"
                          stroke="#C8890A"
                          dot={false}
                          strokeWidth={1.5}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </span>
                </div>
              </td>
              <td className="py-2 pr-4 text-[11px]" style={{ color: 'var(--ae-text2)' }}>{usd(row.thisMonth)}</td>
              <td className="py-2 pr-4 text-[11px]" style={{ color: 'var(--ae-text2)' }}>{usd(row.avgCostPerSession)}</td>
              <td className="py-2 pr-4 text-[11px]" style={{ color: 'var(--ae-text2)' }}>{row.sessionCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
