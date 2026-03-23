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

const STATUS_BADGE: Record<CronRun['status'], string> = {
  success: 'bg-emerald-500/20 text-emerald-400',
  failure: 'bg-red-500/20 text-red-400',
  running: 'bg-indigo-500/20 text-indigo-300',
};

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
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-[#12121a] border-l border-[#1e1e2e] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1e2e]">
          <div>
            <div className="text-white font-semibold text-sm">{cronName}</div>
            <div className="text-[#6b7280] text-xs mt-0.5">Run history (last 20)</div>
          </div>
          <button
            onClick={onClose}
            className="text-[#6b7280] hover:text-white text-lg leading-none transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-32 text-[#6b7280] text-sm">Loading…</div>
          )}
          {error && (
            <div className="m-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">{error}</div>
          )}
          {!loading && !error && runs.length === 0 && (
            <div className="flex items-center justify-center h-32 text-[#6b7280] text-sm">No run history yet</div>
          )}
          {!loading && !error && runs.length > 0 && (
            <div className="divide-y divide-[#1e1e2e]">
              {runs.map((run) => (
                <div key={run.id} className="px-5 py-3">
                  <button
                    className="w-full text-left"
                    onClick={() => setExpandedId(expandedId === run.id ? undefined : run.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[run.status]}`}>
                          {run.status}
                        </span>
                        <span className="text-[#6b7280] text-xs">{relativeTime(run.startedAt)}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[#6b7280]">
                        <span>{formatDuration(run.durationMs)}</span>
                        <span>{expandedId === run.id ? '▲' : '▼'}</span>
                      </div>
                    </div>
                    <div className="text-[#4b5563] text-[11px] mt-0.5 font-mono">
                      {new Date(run.startedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT
                    </div>
                  </button>

                  {expandedId === run.id && (
                    <div className="mt-2 space-y-2">
                      {run.outputExcerpt && (
                        <div>
                          <div className="text-[#6b7280] text-xs mb-1">Output</div>
                          <pre className="bg-[#0a0a0f] border border-[#1e1e2e] rounded p-2 text-[#9ca3af] text-[11px] font-mono whitespace-pre-wrap overflow-x-auto max-h-40 overflow-y-auto">
                            {run.outputExcerpt}
                          </pre>
                        </div>
                      )}
                      {run.errorMessage && (
                        <div>
                          <div className="text-red-400 text-xs mb-1">Error</div>
                          <pre className="bg-red-500/5 border border-red-500/20 rounded p-2 text-red-400 text-[11px] font-mono whitespace-pre-wrap overflow-x-auto max-h-24 overflow-y-auto">
                            {run.errorMessage}
                          </pre>
                        </div>
                      )}
                      {run.driveUrl && (
                        <a
                          href={run.driveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#6366f1] text-xs hover:underline"
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
