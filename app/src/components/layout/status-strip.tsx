// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Needs useEffect for clock, polling, and cookie toggle

import { useEffect, useState, useCallback } from 'react';
import type { GatewayStatusResponse, AgentStatus, GatewayStatus, CostSummary } from '@/types';
import { basePath } from '@/lib/client-url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApiGatewayStatus = { data: GatewayStatusResponse };
type ApiCostSummary = { data: CostSummary };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GATEWAY_POLL_MS = 10_000;
const COST_POLL_MS = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agentStatusColor(status: AgentStatus): string {
  switch (status) {
    case 'ACTIVE':  return 'bg-green-500';
    case 'IDLE':    return 'bg-gray-500';
    case 'ERROR':   return 'bg-red-500';
    case 'OFFLINE': return 'bg-gray-700';
  }
}

function gatewayIndicatorColor(status: GatewayStatus): string {
  switch (status) {
    case 'connected':        return 'bg-green-500';
    case 'reconnecting':     return 'bg-yellow-500 animate-pulse';
    case 'pairing-required': return 'bg-orange-500 animate-pulse';
    case 'disconnected':     return 'bg-gray-600';
  }
}

function gatewayLabel(status: GatewayStatus): string {
  switch (status) {
    case 'connected':        return 'Gateway: online';
    case 'reconnecting':     return 'Gateway: reconnecting\u2026';
    case 'pairing-required': return 'Gateway: pairing required';
    case 'disconnected':     return 'Gateway: offline';
  }
}

function ctClock(): string {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function readHideCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith('mc_hide_sensitive=1'));
}

function setHideCookie(hide: boolean): void {
  if (hide) {
    document.cookie = 'mc_hide_sensitive=1; path=/; SameSite=Strict';
  } else {
    document.cookie = 'mc_hide_sensitive=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatusStrip(): React.JSX.Element {
  const [clock, setClock] = useState<string>(ctClock());
  const [gatewayData, setGatewayData] = useState<GatewayStatusResponse | null>(null);
  const [thisMonthSpend, setThisMonthSpend] = useState<number | null>(null);
  const [hideSensitive, setHideSensitive] = useState<boolean>(false);

  // Sync clock every second
  useEffect(() => {
    const id = setInterval(() => setClock(ctClock()), 1000);
    return () => clearInterval(id);
  }, []);

  // Read hide-sensitive cookie on mount
  useEffect(() => {
    setHideSensitive(readHideCookie());
  }, []);

  // Poll /api/gateway/status every 10s
  const fetchGatewayStatus = useCallback(async () => {
    try {
      const res = await fetch(basePath + '/api/gateway/status');
      if (!res.ok) return;
      const json = (await res.json()) as ApiGatewayStatus;
      setGatewayData(json.data);
    } catch {
      // Network error — leave existing state, don't clear it
    }
  }, []);

  useEffect(() => {
    void fetchGatewayStatus();
    const id = setInterval(() => void fetchGatewayStatus(), GATEWAY_POLL_MS);
    return () => clearInterval(id);
  }, [fetchGatewayStatus]);

  // Poll /api/costs/summary every 15min
  const fetchCostSummary = useCallback(async () => {
    try {
      const res = await fetch(basePath + '/api/costs/summary');
      if (!res.ok) return;
      const json = (await res.json()) as ApiCostSummary;
      setThisMonthSpend(json.data.thisMonth);
    } catch {
      // Cost summary is non-critical — fail silently
    }
  }, []);

  useEffect(() => {
    void fetchCostSummary();
    const id = setInterval(() => void fetchCostSummary(), COST_POLL_MS);
    return () => clearInterval(id);
  }, [fetchCostSummary]);

  function toggleHideSensitive(): void {
    const next = !hideSensitive;
    setHideSensitive(next);
    setHideCookie(next);
  }

  const gwStatus: GatewayStatus = gatewayData?.status ?? 'disconnected';

  return (
    <div className="h-8 border-b border-[#1e1e2e] bg-[#12121a] flex items-center px-4 gap-4 text-xs text-[#6b7280] shrink-0 overflow-hidden pl-12 md:pl-4">
      {/* Gateway health dot — visible on all breakpoints */}
      <span className="flex items-center gap-1.5 shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full inline-block ${gatewayIndicatorColor(gwStatus)}`} />
        {/* Full label only on md+ */}
        <span className="hidden md:inline">{gatewayLabel(gwStatus)}</span>
      </span>

      {/* Per-agent status dots — hidden on mobile */}
      {gatewayData && gatewayData.agentStates.length > 0 && (
        <span className="hidden md:flex items-center gap-2 shrink-0">
          {gatewayData.agentStates.map((agent) => (
            <span
              key={agent.agentId}
              className="flex items-center gap-1"
              title={`${agent.agentId}: ${agent.status}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${agentStatusColor(agent.status)}`} />
              <span className="text-[#4b5563]">{agent.agentId}</span>
            </span>
          ))}
        </span>
      )}

      {/* Month-to-date spend — hidden on mobile */}
      {thisMonthSpend !== null && (
        <span className="hidden md:inline shrink-0">
          {hideSensitive ? '[redacted]' : `$${thisMonthSpend.toFixed(2)} MTD`}
        </span>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Hide-sensitive toggle — hidden on mobile */}
      <button
        onClick={toggleHideSensitive}
        className={`hidden md:inline shrink-0 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
          hideSensitive
            ? 'border-orange-800 text-orange-400 bg-orange-950/30'
            : 'border-[#2a2a3e] text-[#4b5563] hover:text-[#6b7280]'
        }`}
        title={hideSensitive ? 'Show sensitive content' : 'Hide sensitive content'}
      >
        {hideSensitive ? 'HIDDEN' : 'HIDE'}
      </button>

      {/* CT clock — visible on all breakpoints */}
      <span className="font-mono shrink-0">{clock} CT</span>
    </div>
  );
}
