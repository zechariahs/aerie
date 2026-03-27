// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' — manages interactive state for the entire Cron Manager module
'use client';

import { useState, useCallback } from 'react';
import cronstrue from 'cronstrue';
import type { CronJob } from '@/types';
import CronTimeline from './cron-timeline';
import CronJobPanel from './cron-job-panel';
import CronHistoryDrawer from './cron-history-drawer';
import { basePath } from '@/lib/client-url';

interface CronManagerProps {
  initialJobs: CronJob[];
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

function humanSchedule(expr: string): string {
  try { return cronstrue.toString(expr); } catch { return expr; }
}

/** Returns the ae-badge class and label for a cron job row. */
function cronRowBadge(job: CronJob): { cls: string; label: string } {
  if (job.status === 'disabled') return { cls: 'ae-badge ae-badge-off', label: 'Disabled' };
  if (job.status === 'running')  return { cls: 'ae-badge ae-badge-active', label: 'Running' };
  const last = job.lastRun?.status;
  if (last === 'failure') return { cls: 'ae-badge ae-badge-error', label: 'Error' };
  if (last === 'success') return { cls: 'ae-badge ae-badge-ok',    label: 'OK' };
  return { cls: 'ae-badge ae-badge-active', label: 'Active' };
}

export default function CronManager({ initialJobs }: CronManagerProps): React.JSX.Element {
  const [jobs, setJobs] = useState<CronJob[]>(initialJobs);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialJobs[0]?.id);
  const [showHistory, setShowHistory] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const selectedJob = jobs.find((j) => j.id === selectedId);

  /**
   * Re-fetches the cron list from the API.
   * Called after any mutation (enable/disable, schedule update, prompt update)
   * so the panel reflects updated status, and by the manual refresh button.
   */
  const refreshJobs = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const res = await fetch(basePath + '/api/crons');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: CronJob[] };
      setJobs(json.data);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      {loadError && (
        <div
          className="p-3 text-[11px]"
          style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-red-dim)', color: 'var(--ae-red)' }}
        >
          Refresh error: {loadError}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => setShowCalendar((v) => !v)}
          className="text-[10px] uppercase tracking-[0.08em] px-[12px] py-[5px] transition-colors"
          style={{
            fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
            background: 'transparent',
            border: '1px solid var(--ae-border-hi)',
            color: 'var(--ae-text2)',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text2)'; }}
        >
          {showCalendar ? 'Hide Calendar' : 'Show Calendar'}
        </button>
        <button
          onClick={() => void refreshJobs()}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] px-[12px] py-[5px] transition-colors disabled:opacity-40 disabled:cursor-wait"
          style={{
            fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
            background: 'transparent',
            border: '1px solid var(--ae-border-hi)',
            color: 'var(--ae-text2)',
          }}
          onMouseEnter={(e) => { if (!refreshing) (e.currentTarget as HTMLElement).style.color = 'var(--ae-text)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text2)'; }}
        >
          <span className={refreshing ? 'animate-spin inline-block' : ''}>↻</span>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Compact list — default view */}
      <div style={{ border: '1px solid var(--ae-border)' }}>
        {/* Column headers */}
        <div
          className="grid gap-3 px-[14px] py-[7px]"
          style={{
            gridTemplateColumns: '1fr auto auto',
            borderBottom: '1px solid var(--ae-border)',
          }}
        >
          <span className="text-[10px] uppercase tracking-[0.10em]" style={{ color: 'var(--ae-text3)' }}>Name / Schedule</span>
          <span className="text-[10px] uppercase tracking-[0.10em]" style={{ color: 'var(--ae-text3)' }}>Status</span>
          <span className="text-[10px] uppercase tracking-[0.10em]" style={{ color: 'var(--ae-text3)' }}>Last Run</span>
        </div>

        {jobs.map((job) => {
          const badge = cronRowBadge(job);
          const isSelected = selectedId === job.id;
          return (
            <button
              key={job.id}
              onClick={() => setSelectedId(job.id)}
              className="w-full text-left grid gap-3 px-[14px] py-[9px] transition-colors"
              style={{
                gridTemplateColumns: '1fr auto auto',
                alignItems: 'center',
                borderBottom: '1px solid var(--ae-border)',
                borderLeft: isSelected ? '2px solid var(--ae-amber)' : '2px solid transparent',
                background: isSelected ? 'var(--ae-raised)' : 'transparent',
              }}
              onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--ae-surface)'; }}
              onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <div>
                <div className="text-[12px]" style={{ color: 'var(--ae-text)' }}>{job.name}</div>
                <div className="text-[10px] mt-[2px]" style={{ color: 'var(--ae-text2)' }}>
                  {job.schedule} · {humanSchedule(job.schedule)}
                </div>
              </div>
              <span className={badge.cls}>{badge.label}</span>
              <span className="text-[10px]" style={{ color: 'var(--ae-text2)' }}>
                {job.lastRun ? relativeTime(job.lastRun.startedAt) : '—'}
              </span>
            </button>
          );
        })}
      </div>

      {/* Weekly calendar — collapsed by default */}
      {showCalendar && (
        <div className="overflow-x-auto">
          <CronTimeline
            jobs={jobs}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      )}

      {/* Per-job panel */}
      {selectedJob ? (
        <CronJobPanel
          key={selectedJob.id}
          job={selectedJob}
          onShowHistory={() => setShowHistory(true)}
          onJobUpdated={() => void refreshJobs()}
        />
      ) : (
        <div
          className="p-8 text-center text-[11px]"
          style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-border)', color: 'var(--ae-text2)' }}
        >
          Select a cron job above to view details
        </div>
      )}

      {/* Run history drawer */}
      {showHistory && selectedJob && (
        <CronHistoryDrawer
          cronId={selectedJob.id}
          cronName={selectedJob.name}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
