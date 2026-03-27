// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' — uses event handlers and state
'use client';

import { useState, useEffect } from 'react';
import type { CronRun } from '@/types';
import { basePath } from '@/lib/client-url';

interface CronHistoryDrawerProps {
  cronId: string;
  cronName: string;
  onClose: () => void;
}

function runStatusBadge(status: CronRun['status']): string {
  switch (status) {
    case 'success': return 'ae-badge ae-badge-ok';
    case 'failure': return 'ae-badge ae-badge-error';
    case 'running': return 'ae-badge ae-badge-active';
  }
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function CronHistoryDrawer({ cronId, cronName, onClose }: CronHistoryDrawerProps): React.JSX.Element {
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${basePath}/api/crons/${cronId}/runs?limit=20`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data: CronRun[] };
        if (!cancelled) setRuns(json.data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load run history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [cronId]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col"
        style={{
          background: 'var(--ae-void)',
          borderLeft: '1px solid var(--ae-border)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--ae-border)' }}
        >
          <div>
            <div className="text-[13px]" style={{ color: 'var(--ae-text)' }}>{cronName}</div>
            <div className="text-[10px] mt-[2px]" style={{ color: 'var(--ae-text2)' }}>Run history (last 20)</div>
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none transition-colors"
            style={{ color: 'var(--ae-text2)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text2)'; }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-32 text-[11px]" style={{ color: 'var(--ae-text2)' }}>
              Loading…
            </div>
          )}
          {error && (
            <div
              className="m-4 p-3 text-[11px]"
              style={{ border: '1px solid var(--ae-red-dim)', color: 'var(--ae-red)' }}
            >
              {error}
            </div>
          )}
          {!loading && !error && runs.length === 0 && (
            <div className="flex items-center justify-center h-32 text-[11px]" style={{ color: 'var(--ae-text2)' }}>
              No run history yet
            </div>
          )}
          {!loading && !error && runs.length > 0 && (
            <div>
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="px-5 py-3"
                  style={{ borderBottom: '1px solid var(--ae-border)' }}
                >
                  <button
                    className="w-full text-left"
                    onClick={() => setExpandedId(expandedId === run.id ? undefined : run.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={runStatusBadge(run.status)}>{run.status}</span>
                        <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>
                          {relativeTime(run.startedAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--ae-text2)' }}>
                        <span>{formatDuration(run.durationMs)}</span>
                        <span style={{ color: 'var(--ae-text3)' }}>{expandedId === run.id ? '▲' : '▼'}</span>
                      </div>
                    </div>
                    <div className="text-[10px] mt-[3px]" style={{ color: 'var(--ae-text3)' }}>
                      {new Date(run.startedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT
                    </div>
                  </button>

                  {expandedId === run.id && (
                    <div className="mt-2 space-y-2">
                      {run.outputExcerpt && (
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.08em] mb-1" style={{ color: 'var(--ae-text2)' }}>Output</div>
                          <pre
                            className="p-2 text-[11px] whitespace-pre-wrap overflow-x-auto max-h-40 overflow-y-auto"
                            style={{
                              background: 'var(--ae-raised)',
                              border: '1px solid var(--ae-border)',
                              color: 'var(--ae-text)',
                            }}
                          >
                            {run.outputExcerpt}
                          </pre>
                        </div>
                      )}
                      {run.errorMessage && (
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.08em] mb-1" style={{ color: 'var(--ae-red)' }}>Error</div>
                          <pre
                            className="p-2 text-[11px] whitespace-pre-wrap overflow-x-auto max-h-24 overflow-y-auto"
                            style={{
                              background: 'var(--ae-surface)',
                              border: '1px solid var(--ae-red-dim)',
                              color: 'var(--ae-red)',
                            }}
                          >
                            {run.errorMessage}
                          </pre>
                        </div>
                      )}
                      {run.driveUrl && (
                        <a
                          href={run.driveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px]"
                          style={{ color: 'var(--ae-cyan)', textDecoration: 'none' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'underline'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'none'; }}
                        >
                          View in Drive ↗
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
