// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Needs gateway polling for live agent state overlay

import { useEffect, useState, useCallback } from 'react';
import { AgentCard } from './agent-card';
import { ActivityFeed } from './activity-feed';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import type { AgentDescriptor, CostSummary, GatewayStatusResponse, GatewayStatus, AgentState } from '@/types';

interface CommandCenterClientProps {
  agents: AgentDescriptor[];
  initialCostSummary: CostSummary | null;
}

type ApiGatewayStatus = { data: GatewayStatusResponse };

const GATEWAY_POLL_MS = 10_000;

export function CommandCenterClient({ agents, initialCostSummary }: CommandCenterClientProps): React.JSX.Element {
  const [agentStatesMap, setAgentStatesMap] = useState<Map<string, AgentState>>(new Map());
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>('disconnected');

  const fetchGatewayStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/gateway/status');
      if (!res.ok) return;
      const json = (await res.json()) as ApiGatewayStatus;
      const data = json.data;
      setGatewayStatus(data.status);
      const map = new Map<string, AgentState>();
      for (const state of data.agentStates) {
        map.set(state.agentId, state);
      }
      setAgentStatesMap(map);
    } catch {
      // Gateway unreachable — status stays disconnected, agents show OFFLINE
    }
  }, []);

  useEffect(() => {
    void fetchGatewayStatus();
    const id = setInterval(() => void fetchGatewayStatus(), GATEWAY_POLL_MS);
    return () => clearInterval(id);
  }, [fetchGatewayStatus]);

  return (
    <div className="flex flex-col gap-8">
      {/* Agent Cards Grid */}
      <ErrorBoundary label="Agent Cards">
        <section>
          <h2 className="text-sm font-medium text-[#6b7280] mb-3 uppercase tracking-wider">Agents</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                liveState={agentStatesMap.get(agent.id)}
                todayCost={initialCostSummary?.today}
                todaySessionCount={undefined}
              />
            ))}
            {agents.length === 0 && (
              <p className="text-sm text-[#4b5563] col-span-full">
                No agents configured — check openclaw.json or OPENCLAW_DIR.
              </p>
            )}
          </div>
        </section>
      </ErrorBoundary>

      {/* Activity Feed */}
      <ErrorBoundary label="Activity Feed">
        <section>
          <h2 className="text-sm font-medium text-[#6b7280] mb-3 uppercase tracking-wider">
            Activity Feed
            {gatewayStatus === 'connected' && (
              <span className="ml-2 text-[10px] text-green-500 font-normal normal-case tracking-normal">
                ● live
              </span>
            )}
          </h2>
          <div className="bg-[#0f0f1a] border border-[#1e1e2e] rounded-lg p-4">
            <ActivityFeed gatewayStatus={gatewayStatus} />
          </div>
        </section>
      </ErrorBoundary>
    </div>
  );
}
