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

function statusBadgeStyle(status: AgentStatus): React.CSSProperties {
  switch (status) {
    case 'ACTIVE':  return { color: 'var(--ae-amber)',  borderColor: 'var(--ae-amber-dim)' };
    case 'IDLE':    return { color: 'var(--ae-text2)',  borderColor: 'var(--ae-border-hi)' };
    case 'ERROR':   return { color: 'var(--ae-red)',    borderColor: 'var(--ae-red-dim)'   };
    case 'OFFLINE': return { color: 'var(--ae-text3)',  borderColor: 'var(--ae-border)'    };
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
    <div
      className="relative flex flex-col"
      style={{
        background: 'var(--ae-surface)',
        border: '1px solid var(--ae-border)',
      }}
    >
      {/* Corner brackets */}
      <div className="absolute top-[-1px] left-[-1px] w-2 h-2" style={{ borderTop: '1px solid var(--ae-amber)', borderLeft: '1px solid var(--ae-amber)' }} />
      <div className="absolute top-[-1px] right-[-1px] w-2 h-2" style={{ borderTop: '1px solid var(--ae-amber)', borderRight: '1px solid var(--ae-amber)' }} />
      <div className="absolute bottom-[-1px] left-[-1px] w-2 h-2" style={{ borderBottom: '1px solid var(--ae-amber)', borderLeft: '1px solid var(--ae-amber)' }} />
      <div className="absolute bottom-[-1px] right-[-1px] w-2 h-2" style={{ borderBottom: '1px solid var(--ae-amber)', borderRight: '1px solid var(--ae-amber)' }} />

      {/* Header row */}
      <div
        className="flex items-start justify-between gap-2 px-[13px] py-[11px]"
        style={{ borderBottom: '1px solid var(--ae-border)' }}
      >
        <div>
          <h3 className="text-[13px]" style={{ color: 'var(--ae-text)' }}>{agent.name}</h3>
          <p className="text-[10px]" style={{ color: 'var(--ae-text2)', marginTop: '2px' }}>{agent.id}</p>
        </div>
        <span
          className="text-[10px] uppercase tracking-[0.08em] px-[6px] py-[2px] shrink-0"
          style={{ border: '1px solid', ...statusBadgeStyle(status) }}
        >
          {statusLabel(status)}
        </span>
      </div>

      {/* Model */}
      <div
        className="px-[13px] py-[9px] text-[10px] truncate"
        style={{ color: 'var(--ae-text2)', borderBottom: '1px solid var(--ae-border)' }}
        title={agent.model}
      >
        {agent.model.replace('openrouter/', '')}
      </div>

      {/* Stats row */}
      <div
        className="flex items-center gap-[18px] px-[13px] py-[9px] text-[11px]"
        style={{ color: 'var(--ae-text2)', borderBottom: '1px solid var(--ae-border)' }}
      >
        <div>
          Last active{' '}
          <span style={{ color: 'var(--ae-text)' }}>{relativeTime(liveState?.lastActiveAt ?? null)}</span>
        </div>
        {todaySessionCount !== undefined && (
          <div>
            Sessions{' '}
            <span style={{ color: 'var(--ae-text)' }}>{todaySessionCount}</span>
          </div>
        )}
        {todayCost !== undefined && (
          <div>
            Cost{' '}
            <span style={{ color: 'var(--ae-text)' }}>${todayCost.toFixed(4)}</span>
          </div>
        )}
      </div>

      {/* Buttons row */}
      <div className="flex items-center gap-2 px-[13px] py-[10px]">
        <button
          onClick={() => router.push(`/tasks?agent=${agent.id}`)}
          className="text-[10px] uppercase tracking-[0.08em] px-[12px] py-[5px] cursor-pointer transition-opacity hover:opacity-80"
          style={{
            fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
            background: 'var(--ae-amber)',
            color: 'var(--ae-void)',
            border: 'none',
          }}
        >
          + New Task
        </button>
      </div>
    </div>
  );
}
