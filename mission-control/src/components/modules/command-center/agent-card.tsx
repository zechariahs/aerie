// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

import { useRouter } from 'next/navigation';
import type { AgentDescriptor, AgentState, AgentStatus } from '@/types';

interface AgentCardProps {
  agent: AgentDescriptor;
  /** Live state from Gateway bridge; undefined when Gateway is disconnected. */
  liveState: AgentState | undefined;
  todayCost: number | undefined;
  todaySessionCount: number | undefined;
}

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case 'ACTIVE':  return 'Active';
    case 'IDLE':    return 'Idle';
    case 'ERROR':   return 'Error';
    case 'OFFLINE': return 'Offline';
  }
}

function statusBadgeClass(status: AgentStatus): string {
  switch (status) {
    case 'ACTIVE':  return 'bg-green-900/60 text-green-400 border border-green-800';
    case 'IDLE':    return 'bg-gray-800/60 text-gray-400 border border-gray-700';
    case 'ERROR':   return 'bg-red-900/60 text-red-400 border border-red-800';
    case 'OFFLINE': return 'bg-gray-900/60 text-gray-600 border border-gray-800';
  }
}

function statusDotClass(status: AgentStatus): string {
  switch (status) {
    case 'ACTIVE':  return 'bg-green-500 animate-pulse';
    case 'IDLE':    return 'bg-gray-500';
    case 'ERROR':   return 'bg-red-500';
    case 'OFFLINE': return 'bg-gray-700';
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'unknown';
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function AgentCard({ agent, liveState, todayCost, todaySessionCount }: AgentCardProps): React.JSX.Element {
  const router = useRouter();
  const status: AgentStatus = liveState?.status ?? 'OFFLINE';

  return (
    <div className="bg-[#0f0f1a] border border-[#1e1e2e] rounded-lg p-4 flex flex-col gap-3 hover:border-[#2a2a3e] transition-colors">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">{agent.name}</h3>
          <p className="text-xs text-[#4b5563] mt-0.5">{agent.id}</p>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1.5 shrink-0 ${statusBadgeClass(status)}`}>
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${statusDotClass(status)}`} />
          {statusLabel(status)}
        </span>
      </div>

      {/* Model */}
      <div className="text-xs text-[#4b5563] truncate" title={agent.model}>
        {agent.model.replace('openrouter/', '')}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs">
        <div>
          <span className="text-[#4b5563]">Last active</span>
          <span className="text-[#6b7280] ml-1">{relativeTime(liveState?.lastActiveAt ?? null)}</span>
        </div>
        {todaySessionCount !== undefined && (
          <div>
            <span className="text-[#4b5563]">Sessions</span>
            <span className="text-[#6b7280] ml-1">{todaySessionCount}</span>
          </div>
        )}
        {todayCost !== undefined && (
          <div>
            <span className="text-[#4b5563]">Cost</span>
            <span className="text-[#6b7280] ml-1">${todayCost.toFixed(4)}</span>
          </div>
        )}
      </div>

      {/* New Task button */}
      <button
        onClick={() => router.push(`/tasks?agent=${agent.id}`)}
        className="mt-auto text-xs px-3 py-1.5 rounded border border-[#2a2a3e] text-[#6b7280] hover:text-white hover:border-[#3a3a4e] transition-colors text-left"
      >
        + New Task
      </button>
    </div>
  );
}
