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
// Event type icons & colors
// ---------------------------------------------------------------------------

const EVENT_ICONS: Record<ActivityEventType, string> = {
  'cron.start':    '\u23f1',    // ⏱
  'cron.end':      '\u2713',    // ✓
  'cron.error':    '\u2717',    // ✗
  'session.start': '\u25b6',    // ▶
  'session.end':   '\u25a0',    // ■
  'tool.call':     '\u{1F527}', // 🔧
  'message.sent':  '\u2709',    // ✉
  'error':         '\u26a0',    // ⚠
};

const EVENT_COLOR: Record<ActivityEventType, string> = {
  'cron.start':    'var(--ae-text2)',
  'cron.end':      'var(--ae-text2)',
  'cron.error':    'var(--ae-red)',
  'session.start': 'var(--ae-text2)',
  'session.end':   'var(--ae-text2)',
  'tool.call':     'var(--ae-cyan)',
  'message.sent':  'var(--ae-text)',
  'error':         'var(--ae-red)',
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
    <div className="flex flex-wrap items-center gap-2 text-[10px]">
      {/* Agent dropdown */}
      {agentIds.length > 1 && (
        <select
          value={filter.agentId}
          onChange={(e) => onChange({ ...filter, agentId: e.target.value })}
          className="px-2 py-1 text-[10px] uppercase tracking-[0.06em]"
          style={{
            background: 'var(--ae-raised)',
            border: '1px solid var(--ae-border-hi)',
            color: 'var(--ae-text2)',
            fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
          }}
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
            className="px-[6px] py-[2px] uppercase tracking-[0.06em] transition-colors"
            style={
              active
                ? {
                    border: '1px solid var(--ae-border-hi)',
                    color: 'var(--ae-text2)',
                  }
                : {
                    border: '1px solid var(--ae-border)',
                    color: 'var(--ae-text3)',
                  }
            }
          >
            {EVENT_ICONS[t]} {t}
          </button>
        );
      })}

      {/* Clear filters */}
      {(filter.agentId !== '' || filter.types.size > 0) && (
        <button
          onClick={() => onChange({ agentId: '', types: new Set() })}
          className="px-[6px] py-[2px] uppercase tracking-[0.06em] transition-colors"
          style={{
            border: '1px solid var(--ae-border-hi)',
            color: 'var(--ae-text2)',
          }}
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
      <div className="flex items-center justify-center h-48 text-[11px]" style={{ color: 'var(--ae-text3)' }}>
        Gateway offline — activity feed paused
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <FilterBar agentIds={agentIds} filter={filter} onChange={setFilter} />

      {/* Feed list */}
      <div className="flex flex-col min-h-48">
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <span className="text-[11px]" style={{ color: 'var(--ae-text3)' }}>
              Waiting for activity\u2026
            </span>
          </div>
        ) : (
          visible.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-3 px-3 py-[6px] transition-colors"
              style={{ borderBottom: '1px solid var(--ae-border)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--ae-raised)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
            >
              {/* Icon */}
              <span
                className="text-[11px] shrink-0 w-4 text-center"
                style={{ color: EVENT_COLOR[event.type] }}
              >
                {EVENT_ICONS[event.type]}
              </span>

              {/* Summary */}
              <span className="text-[11px] flex-1 min-w-0 truncate" style={{ color: 'var(--ae-text)' }}>
                {maybeSummary(event, hideSensitive)}
              </span>

              {/* Agent ID (when multiple agents present) */}
              {agentIds.length > 1 && (
                <span className="text-[10px] shrink-0" style={{ color: 'var(--ae-text3)' }}>
                  {event.agentId}
                </span>
              )}

              {/* Timestamp */}
              <span className="text-[10px] shrink-0" style={{ color: 'var(--ae-text3)' }}>
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
