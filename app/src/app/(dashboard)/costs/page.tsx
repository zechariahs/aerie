// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' required — agent filter state is shared across panels
'use client';

import React, { useState } from 'react';
import { ModuleErrorBoundary } from '@/components/modules/costs/module-error-boundary';
import DailySpendChart from '@/components/modules/costs/daily-spend-chart';
import AgentSummaryTable from '@/components/modules/costs/agent-summary-table';
import CronSummaryTable from '@/components/modules/costs/cron-summary-table';
import SessionInspector from '@/components/modules/costs/session-inspector';
import MonthlyProjection from '@/components/modules/costs/monthly-projection';
import PriceTableEditor from '@/components/modules/costs/price-table-editor';

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className="p-4"
      style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-border)' }}
    >
      <p className="ae-section-label mb-4">── {title} ────────────────────────</p>
      {children}
    </section>
  );
}

export default function CostsPage(): React.JSX.Element {
  const [agentFilter, setAgentFilter] = useState<string | undefined>();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[14px] font-[500]" style={{ color: 'var(--ae-text)' }}>
          Cost &amp; Token Tracking
        </h1>
      </div>

      <ModuleErrorBoundary title="Daily Spend Chart">
        <Panel title="Daily Spend (last 30 days)">
          <DailySpendChart days={30} />
        </Panel>
      </ModuleErrorBoundary>

      <ModuleErrorBoundary title="Monthly Projection">
        <Panel title="Monthly Projection">
          <MonthlyProjection />
        </Panel>
      </ModuleErrorBoundary>

      <ModuleErrorBoundary title="Per-Agent Summary">
        <Panel title="Per-Agent Summary">
          <AgentSummaryTable onAgentFilter={setAgentFilter} activeAgent={agentFilter} />
        </Panel>
      </ModuleErrorBoundary>

      <ModuleErrorBoundary title="Per-Cron Summary">
        <Panel title="Per-Cron Summary">
          <CronSummaryTable />
        </Panel>
      </ModuleErrorBoundary>

      <ModuleErrorBoundary title="Session Inspector">
        <Panel
          title={
            agentFilter
              ? `Session Inspector — ${agentFilter}`
              : 'Session Inspector'
          }
        >
          <SessionInspector agentFilter={agentFilter} />
        </Panel>
      </ModuleErrorBoundary>

      <ModuleErrorBoundary title="Price Table Editor">
        <Panel title="Price Table Editor">
          <PriceTableEditor />
        </Panel>
      </ModuleErrorBoundary>
    </div>
  );
}
