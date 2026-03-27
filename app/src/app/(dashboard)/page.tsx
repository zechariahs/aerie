// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Command Center — Module 1.
 *
 * Server component: fetches agents and initial gateway status, then passes
 * them to client components for live updates. Agent cards and the activity
 * feed are each wrapped in an error boundary.
 */

import { getAgents } from '@/lib/openclaw';
import { getCostSummary, getAgentTodayCosts } from '@/lib/cost';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { CommandCenterClient } from '@/components/modules/command-center/command-center-client';

export default async function CommandCenterPage(): Promise<React.JSX.Element> {
  const [agents, costSummary] = await Promise.allSettled([
    Promise.resolve(getAgents()),
    getCostSummary(),
  ]);

  const agentList = agents.status === 'fulfilled' ? agents.value : [];
  const summary = costSummary.status === 'fulfilled' ? costSummary.value : null;
  const agentTodayCosts = getAgentTodayCosts();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[14px] font-[500]" style={{ color: 'var(--ae-text)' }}>
          Command Center
        </h1>
        <p
          className="text-[11px] tracking-[0.04em]"
          style={{ color: 'var(--ae-text2)', marginTop: '3px' }}
        >
          Agent status and live activity feed
        </p>
      </div>

      <ErrorBoundary label="Command Center">
        <CommandCenterClient agents={agentList} initialCostSummary={summary} agentTodayCosts={agentTodayCosts} />
      </ErrorBoundary>
    </div>
  );
}
