// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

// useEffect is needed for EventSource (SSE) subscription — client-only browser API.

import { useEffect, useRef, useState, useMemo } from 'react';
import type { ActivityEvent, ActivityEventType, CronRun, GatewayStatus } from '@/types';
import { basePath } from '@/lib/client-url';

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
// Host-agent envelope → ActivityEvent mapper
// ---------------------------------------------------------------------------

/** Noisy internal event types that should not appear in the activity feed. */
const SKIP_ENVELOPE_TYPES = new Set(['thinking_level_change', 'model-snapshot', 'openclaw.cache-ttl']);

/** Direct mapping of raw JSONL types to ActivityEventType. */
const ENVELOPE_TYPE_MAP: Record<string, ActivityEventType> = {
  'cron.start':    'cron.start',
  'cron.end':      'cron.end',
  'cron.error':    'cron.error',
  'session.start': 'session.start',
  'session.end':   'session.end',
  'tool.call':     'tool.call',
  'tool_call':     'tool.call',
  'message':       'message.sent',
  'message.sent':  'message.sent',
  'error':         'error',
};

/**
 * Converts a raw host-agent SSE envelope (or legacy ActivityEvent) into an
 * ActivityEvent suitable for the feed. Returns null to skip noisy events.
 */
function parseEnvelope(data: Record<string, unknown>): ActivityEvent | null {
  // Legacy ActivityEvent shape (id + timestamp + summary already present)
  if (typeof data['id'] === 'string' && typeof data['timestamp'] === 'string' && typeof data['summary'] === 'string') {
    return data as unknown as ActivityEvent;
  }

  // Host-agent envelope shape: { ts, source, agentId, sessionId, type, raw }
  const source = data['source'] as string | undefined;
  const rawType = typeof data['type'] === 'string' ? data['type'] : 'unknown';
  const ts = typeof data['ts'] === 'string' ? data['ts'] : new Date().toISOString();
  const agentId = typeof data['agentId'] === 'string' ? data['agentId'] : 'unknown';
  const raw = (typeof data['raw'] === 'object' && data['raw'] !== null ? data['raw'] : {}) as Record<string, unknown>;

  // Skip noisy internal types
  if (SKIP_ENVELOPE_TYPES.has(rawType)) return null;
  const customType = typeof raw['customType'] === 'string' ? raw['customType'] : null;
  if (customType && SKIP_ENVELOPE_TYPES.has(customType)) return null;

  // For session message events, only surface assistant messages
  if (rawType === 'message') {
    const msg = (typeof raw['message'] === 'object' && raw['message'] !== null ? raw['message'] : null) as Record<string, unknown> | null;
    if (msg?.['role'] !== 'assistant') return null;
  }

  const mappedType: ActivityEventType =
    ENVELOPE_TYPE_MAP[rawType] ??
    (source === 'cron_run' ? 'cron.end' : null) ??
    'error';

  // Build a human-readable summary
  let summary: string;
  if (source === 'cron_run') {
    const rawSummary = typeof raw['summary'] === 'string' ? raw['summary'] : null;
    const status = typeof raw['status'] === 'string' ? raw['status'] : 'ok';
    summary = rawSummary ? rawSummary : `Cron run completed (${status})`;
  } else if (rawType === 'message') {
    const msg = (typeof raw['message'] === 'object' && raw['message'] !== null ? raw['message'] : {}) as Record<string, unknown>;
    const content = msg['content'];
    const text = typeof content === 'string' ? content :
      (Array.isArray(content) && typeof (content[0] as Record<string, unknown>)?.['text'] === 'string')
        ? (content[0] as Record<string, unknown>)['text'] as string
        : '';
    summary = (text.slice(0, 120)) || 'Message';
  } else {
    summary = rawType;
  }

  return {
    id: `${ts}-${agentId}-${rawType}`,
    type: mappedType,
    agentId,
    summary,
    meta: raw,
    timestamp: ts,
  };
}

/** Convert a CronRun DB record to an ActivityEvent for the historical backfill. */
function cronRunToActivityEvent(run: CronRun): ActivityEvent {
  const type: ActivityEventType =
    run.status === 'success' ? 'cron.end' :
    run.status === 'running' ? 'cron.start' :
    'cron.error';

  const summary =
    run.outputExcerpt ? run.outputExcerpt.slice(0, 120) :
    run.errorMessage ? run.errorMessage.slice(0, 120) :
    `Cron run (${run.status})`;

  return {
    id: run.id,
    type,
    agentId: run.cronId,
    summary,
    meta: {
      cronId: run.cronId,
      status: run.status,
      durationMs: run.durationMs,
      model: run.model,
    },
    timestamp: run.startedAt,
  };
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
  /** Agent IDs from openclaw.json — used to pre-populate the filter dropdown. */
  configuredAgentIds: string[];
}

export function ActivityFeed({ gatewayStatus, configuredAgentIds }: ActivityFeedProps): React.JSX.Element {
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

  // Connect to SSE endpoint — independent of gateway status (source is host agent)
  useEffect(() => {
    const es = new EventSource('/api/events');

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as Record<string, unknown>;
        // Ignore disconnect sentinel and heartbeat artifacts
        if (data['type'] === 'disconnect') return;

        const event = parseEnvelope(data);
        if (!event) return;

        setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
      } catch {
        // Malformed event — ignore
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; we don't need to handle this explicitly
    };

    return () => es.close();
  }, []);

  // Pre-populate feed with recent historical cron runs on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(basePath + '/api/crons/recent-runs?limit=30');
        if (!res.ok) return;
        const json = (await res.json()) as { data: CronRun[] };
        const initial = (json.data ?? []).map(cronRunToActivityEvent);
        if (initial.length > 0) {
          setEvents((prev) => {
            // Only set if no live events have arrived yet — avoid overwriting live events
            if (prev.length > 0) return prev;
            return initial.slice(0, MAX_EVENTS);
          });
        }
      } catch {
        // Non-fatal — feed will still show live events as they arrive
      }
    })();
  }, []);

  // Merge configured agent IDs with any IDs seen in live events
  const agentIds = useMemo(
    () => Array.from(new Set([...configuredAgentIds, ...events.map((e) => e.agentId)])),
    [configuredAgentIds, events],
  );

  // Apply filters
  const visible = useMemo(() => {
    return events.filter((e) => {
      if (filter.agentId && e.agentId !== filter.agentId) return false;
      if (filter.types.size > 0 && !filter.types.has(e.type)) return false;
      return true;
    });
  }, [events, filter]);

  return (
    <div className="flex flex-col gap-3">
      {/* Gateway offline banner — shown above the feed (does not block SSE) */}
      {gatewayStatus === 'disconnected' && (
        <div className="text-[10px] px-3 py-1 text-center" style={{ color: 'var(--ae-text3)', background: 'var(--ae-raised)', border: '1px solid var(--ae-border)' }}>
          Gateway offline — live commands unavailable
        </div>
      )}
      {/* Filter bar */}
      <FilterBar agentIds={agentIds} filter={filter} onChange={setFilter} />

      {/* Feed list */}
      <div className="flex flex-col min-h-48">
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <span className="text-[11px]" style={{ color: 'var(--ae-text3)' }}>
              {'Waiting for activity\u2026'}
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
