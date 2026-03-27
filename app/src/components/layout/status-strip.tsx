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

function agentDotColor(status: AgentStatus): string {
  switch (status) {
    case 'ACTIVE':  return 'var(--ae-green)';
    case 'IDLE':    return 'var(--ae-text3)';
    case 'ERROR':   return 'var(--ae-red)';
    case 'OFFLINE': return 'var(--ae-border-hi)';
  }
}

function gatewayDotColor(status: GatewayStatus): string {
  switch (status) {
    case 'connected':        return 'var(--ae-green)';
    case 'reconnecting':     return 'var(--ae-warn)';
    case 'pairing-required': return 'var(--ae-warn)';
    case 'disconnected':     return 'var(--ae-text3)';
  }
}

function gatewayLabel(status: GatewayStatus): string {
  switch (status) {
    case 'connected':        return 'GATEWAY: ONLINE';
    case 'reconnecting':     return 'GATEWAY: RECONNECTING\u2026';
    case 'pairing-required': return 'GATEWAY: PAIRING REQUIRED';
    case 'disconnected':     return 'GATEWAY: OFFLINE';
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
  const isReconnecting = gwStatus === 'reconnecting' || gwStatus === 'pairing-required';

  return (
    <div
      className="h-[30px] border-b flex items-center px-4 gap-3 text-[11px] shrink-0 overflow-hidden pl-12 md:pl-4"
      style={{
        background: 'var(--ae-void)',
        borderColor: 'var(--ae-border)',
        color: 'var(--ae-text2)',
      }}
    >
      {/* Gateway health dot + label — visible on all breakpoints */}
      <span className="flex items-center gap-1.5 shrink-0">
        <span
          className={`w-[6px] h-[6px] rounded-full inline-block shrink-0${isReconnecting ? ' animate-pulse' : ''}`}
          style={{ background: gatewayDotColor(gwStatus) }}
        />
        <span
          className="hidden md:inline"
          style={{ color: 'var(--ae-text)' }}
        >
          {gatewayLabel(gwStatus)}
        </span>
      </span>

      {/* Separator */}
      <span className="hidden md:inline shrink-0" style={{ color: 'var(--ae-border-hi)' }}>·</span>

      {/* Month-to-date spend — hidden on mobile */}
      {thisMonthSpend !== null && (
        <>
          <span
            className="hidden md:inline shrink-0"
            style={{ color: 'var(--ae-amber)' }}
          >
            {hideSensitive ? '[redacted]' : `$${thisMonthSpend.toFixed(2)} MTD`}
          </span>
          <span className="hidden md:inline shrink-0" style={{ color: 'var(--ae-border-hi)' }}>·</span>
        </>
      )}

      {/* Per-agent names + error badges — hidden on mobile */}
      {gatewayData && gatewayData.agentStates.length > 0 && (
        <span className="hidden md:flex items-center gap-2 shrink-0">
          {gatewayData.agentStates.map((agent) => (
            <span
              key={agent.agentId}
              className="flex items-center gap-1"
              title={`${agent.agentId}: ${agent.status}`}
            >
              <span
                className="w-[6px] h-[6px] rounded-full inline-block shrink-0"
                style={{ background: agentDotColor(agent.status) }}
              />
              <span style={{ color: 'var(--ae-text2)' }}>{agent.agentId}</span>
              {agent.status === 'ERROR' && (
                <span
                  className="text-[10px] tracking-[0.06em]"
                  style={{ color: 'var(--ae-red)' }}
                >
                  [ERR]
                </span>
              )}
            </span>
          ))}
        </span>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Hide-sensitive toggle — hidden on mobile */}
      <button
        onClick={toggleHideSensitive}
        className="hidden md:inline shrink-0 px-1.5 py-0.5 text-[10px] border transition-colors tracking-[0.06em]"
        style={
          hideSensitive
            ? {
                borderColor: 'var(--ae-warn-dim)',
                color: 'var(--ae-warn)',
              }
            : {
                borderColor: 'var(--ae-border-hi)',
                color: 'var(--ae-text3)',
              }
        }
        title={hideSensitive ? 'Show sensitive content' : 'Hide sensitive content'}
      >
        {hideSensitive ? 'HIDDEN' : 'HIDE'}
      </button>

      {/* CT clock — visible on all breakpoints */}
      <span className="shrink-0" style={{ color: 'var(--ae-text2)' }}>{clock} CT</span>
    </div>
  );
}
