// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

// useEffect is needed for EventSource (SSE) subscription — client-only browser API.

import { useEffect, useRef, useState, useMemo } from 'react';
import type { ActivityEvent, ActivityEventType, GatewayStatus } from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS = 200; // keep last N events in state

// ---------------------------------------------------------------------------
// Event type icons & labels
// ---------------------------------------------------------------------------

const EVENT_ICONS: Record<ActivityEventType, string> = {
  'cron.start':    '\u23f1',  // ⏱
  'cron.end':      '\u2713',  // ✓
  'cron.error':    '\u2717',  // ✗
  'session.start': '\u25b6',  // ▶
  'session.end':   '\u25a0',  // ■
  'tool.call':     '\u{1F527}', // 🔧
  'message.sent':  '\u2709',  // ✉
  'error':         '\u26a0',  // ⚠
};

const EVENT_COLORS: Record<ActivityEventType, string> = {
  'cron.start':    'text-blue-400',
  'cron.end':      'text-green-400',
  'cron.error':    'text-red-400',
  'session.start': 'text-purple-400',
  'session.end':   'text-purple-300',
  'tool.call':     'text-yellow-400',
  'message.sent':  'text-cyan-400',
  'error':         'text-red-500',
};

const ALL_EVENT_TYPES: ActivityEventType[] = [
  'cron.start', 'cron.end', 'cron.error',
  'session.start', 'session.end',
  'tool.call', 'message.sent', 'error',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
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

const REDACT_TYPES: Set<ActivityEventType> = new Set(['message.sent', 'tool.call']);

function maybeSummary(event: ActivityEvent, hide: boolean): string {
  if (hide && REDACT_TYPES.has(event.type)) return '[redacted]';
  return event.summary;
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

interface FilterState {
  agentId: string; // '' = all
  types: Set<ActivityEventType>; // empty = all
}

interface FilterBarProps {
  agentIds: string[];
  filter: FilterState;
  onChange: (f: FilterState) => void;
}

function FilterBar({ agentIds, filter, onChange }: FilterBarProps): React.JSX.Element {
  function toggleType(t: ActivityEventType): void {
    const next = new Set(filter.types);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onChange({ ...filter, types: next });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {/* Agent dropdown */}
      {agentIds.length > 1 && (
        <select
          value={filter.agentId}
          onChange={(e) => onChange({ ...filter, agentId: e.target.value })}
          className="bg-[#0f0f1a] border border-[#2a2a3e] text-[#6b7280] rounded px-2 py-1 text-xs"
        >
          <option value="">All agents</option>
          {agentIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      )}

      {/* Event type pills */}
      {ALL_EVENT_TYPES.map((t) => {
        const active = filter.types.size === 0 || filter.types.has(t);
        return (
          <button
            key={t}
            onClick={() => toggleType(t)}
            className={`px-2 py-0.5 rounded border transition-colors ${
              active
                ? 'border-[#2a2a3e] text-[#9ca3af]'
                : 'border-transparent text-[#374151] opacity-50'
            }`}
          >
            {EVENT_ICONS[t]} {t}
          </button>
        );
      })}

      {/* Clear filters */}
      {(filter.agentId !== '' || filter.types.size > 0) && (
        <button
          onClick={() => onChange({ agentId: '', types: new Set() })}
          className="px-2 py-0.5 rounded border border-[#2a2a3e] text-[#4b5563] hover:text-[#6b7280]"
        >
          Clear
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ActivityFeedProps {
  gatewayStatus: GatewayStatus;
}

export function ActivityFeed({ gatewayStatus }: ActivityFeedProps): React.JSX.Element {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [filter, setFilter] = useState<FilterState>({ agentId: '', types: new Set() });
  const [hideSensitive, setHideSensitive] = useState<boolean>(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Read hide-sensitive cookie on mount and on each render (cookie may change via status strip)
  useEffect(() => {
    const check = (): void => setHideSensitive(readHideCookie());
    check();
    // Re-check every 2s — simple polling since we can't listen to cookie changes
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, []);

  // Connect to SSE endpoint
  useEffect(() => {
    if (gatewayStatus === 'disconnected') return;

    const es = new EventSource('/api/events');

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as ActivityEvent;
        setEvents((prev) => {
          const next = [event, ...prev];
          // Keep only the last MAX_EVENTS events (newest first)
          return next.slice(0, MAX_EVENTS);
        });
      } catch {
        // Malformed event — ignore
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; we don't need to handle this explicitly
    };

    return () => es.close();
  }, [gatewayStatus]);

  // Derive unique agent IDs from received events
  const agentIds = useMemo(
    () => Array.from(new Set(events.map((e) => e.agentId))),
    [events],
  );

  // Apply filters
  const visible = useMemo(() => {
    return events.filter((e) => {
      if (filter.agentId && e.agentId !== filter.agentId) return false;
      if (filter.types.size > 0 && !filter.types.has(e.type)) return false;
      return true;
    });
  }, [events, filter]);

  // Gateway offline state
  if (gatewayStatus === 'disconnected') {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-[#4b5563]">
        Gateway offline — activity feed paused
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <FilterBar agentIds={agentIds} filter={filter} onChange={setFilter} />

      {/* Feed list */}
      <div className="flex flex-col gap-1 min-h-48">
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <span className="text-sm text-[#374151] animate-pulse">
              Waiting for activity\u2026
            </span>
          </div>
        ) : (
          visible.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-3 px-3 py-2 rounded hover:bg-[#0f0f1a] transition-colors group"
            >
              {/* Icon */}
              <span className={`text-sm shrink-0 w-4 text-center ${EVENT_COLORS[event.type]}`}>
                {EVENT_ICONS[event.type]}
              </span>

              {/* Summary */}
              <span className="text-xs text-[#9ca3af] flex-1 min-w-0 truncate">
                {maybeSummary(event, hideSensitive)}
              </span>

              {/* Agent ID (when multiple agents present) */}
              {agentIds.length > 1 && (
                <span className="text-[10px] text-[#374151] shrink-0">{event.agentId}</span>
              )}

              {/* Timestamp */}
              <span className="text-[10px] text-[#374151] shrink-0 font-mono">
                {formatTime(event.timestamp)}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
