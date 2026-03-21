// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' — uses event handlers, state, and fetches
'use client';

import { useState } from 'react';
import cronstrue from 'cronstrue';
import { CronExpressionParser } from 'cron-parser';
import type { CronJob } from '@/types';
import TotpDialog from './totp-dialog';

const TZ = 'America/Chicago';

interface CronJobPanelProps {
  job: CronJob;
  onShowHistory: () => void;
  onJobUpdated: () => void;
}

type DialogAction = 'trigger' | 'enable' | 'disable' | 'schedule';

interface ApiError {
  error: string;
}

function computeNextRun(schedule: string): string {
  try {
    const expr = CronExpressionParser.parse(schedule, { tz: TZ });
    const next = expr.next().toDate();
    return next.toLocaleString('en-US', {
      timeZone: TZ,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' CT';
  } catch {
    return 'Unknown';
  }
}

function humanReadableSchedule(schedule: string): string {
  try {
    return cronstrue.toString(schedule);
  } catch {
    return schedule;
  }
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

const STATUS_BADGE: Record<CronJob['status'], string> = {
  active: 'bg-emerald-500/20 text-emerald-400',
  disabled: 'bg-[#1e1e2e] text-[#6b7280]',
  running: 'bg-indigo-500/20 text-indigo-300',
};

const RUN_STATUS_BADGE: Record<string, string> = {
  success: 'bg-emerald-500/20 text-emerald-400',
  failure: 'bg-red-500/20 text-red-400',
  running: 'bg-indigo-500/20 text-indigo-300',
};

export default function CronJobPanel({ job, onShowHistory, onJobUpdated }: CronJobPanelProps): React.JSX.Element {
  const [pendingAction, setPendingAction] = useState<DialogAction | undefined>();
  const [triggerState, setTriggerState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [triggerError, setTriggerError] = useState('');
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleInput, setScheduleInput] = useState(job.schedule);
  const [scheduleError, setScheduleError] = useState('');
  const [toast, setToast] = useState('');

  function showToast(msg: string): void {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function handleTrigger(totpToken: string): Promise<void> {
    setPendingAction(undefined);
    setTriggerState('loading');
    setTriggerError('');
    try {
      const res = await fetch(`/api/crons/${job.id}/trigger`, {
        method: 'POST',
        headers: { 'X-TOTP-Token': totpToken },
      });
      if (!res.ok) {
        const err = (await res.json()) as ApiError;
        setTriggerState('error');
        setTriggerError(err.error ?? 'Trigger failed');
        return;
      }
      setTriggerState('success');
      showToast('Cron triggered successfully');
      onJobUpdated();
      setTimeout(() => setTriggerState('idle'), 4000);
    } catch {
      setTriggerState('error');
      setTriggerError('Network error');
    }
  }

  async function handleSetEnabled(totpToken: string, enabled: boolean): Promise<void> {
    setPendingAction(undefined);
    try {
      const res = await fetch(`/api/crons/${job.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': totpToken,
        },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const err = (await res.json()) as ApiError;
        showToast(`Error: ${err.error ?? 'Update failed'}`);
        return;
      }
      showToast(enabled ? 'Cron enabled' : 'Cron disabled');
      onJobUpdated();
    } catch {
      showToast('Network error');
    }
  }

  async function handleSaveSchedule(totpToken: string): Promise<void> {
    setPendingAction(undefined);
    const trimmed = scheduleInput.trim();
    if (!/^\S+(\s+\S+){4}$/.test(trimmed)) {
      setScheduleError('Must be a 5-field cron expression (e.g. 0 5 * * *)');
      return;
    }
    try {
      const res = await fetch(`/api/crons/${job.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': totpToken,
        },
        body: JSON.stringify({ schedule: trimmed }),
      });
      if (!res.ok) {
        const err = (await res.json()) as ApiError;
        showToast(`Error: ${err.error ?? 'Update failed'}`);
        return;
      }
      setEditingSchedule(false);
      setScheduleError('');
      showToast('Schedule updated');
      onJobUpdated();
    } catch {
      showToast('Network error');
    }
  }

  function handleDialogConfirm(totpToken: string): void {
    if (pendingAction === 'trigger') void handleTrigger(totpToken);
    else if (pendingAction === 'enable') void handleSetEnabled(totpToken, true);
    else if (pendingAction === 'disable') void handleSetEnabled(totpToken, false);
    else if (pendingAction === 'schedule') void handleSaveSchedule(totpToken);
  }

  return (
    <div className="bg-[#12121a] border border-[#1e1e2e] rounded-lg p-5 space-y-5">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1e1e2e] border border-[#3f3f5a] text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* TOTP dialog */}
      {pendingAction && (
        <TotpDialog
          title={
            pendingAction === 'trigger' ? 'Confirm Trigger' :
            pendingAction === 'enable' ? 'Confirm Enable' :
            pendingAction === 'disable' ? 'Confirm Disable' :
            'Confirm Schedule Change'
          }
          description={
            pendingAction === 'trigger' ? `Run "${job.name}" now?` :
            pendingAction === 'enable' ? `Enable "${job.name}"?` :
            pendingAction === 'disable' ? `Disable "${job.name}"?` :
            `Change schedule to: ${scheduleInput.trim()}`
          }
          onConfirm={handleDialogConfirm}
          onCancel={() => setPendingAction(undefined)}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-white font-semibold text-base">{job.name}</h2>
          <div className="text-[#4b5563] text-xs font-mono mt-0.5">{job.id}</div>
        </div>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[job.status]}`}>
          {job.status.toUpperCase()}
        </span>
      </div>

      {/* Schedule */}
      <div className="space-y-1.5">
        <div className="text-[#6b7280] text-xs uppercase tracking-wide">Schedule</div>
        {editingSchedule ? (
          <div className="space-y-2">
            <input
              type="text"
              value={scheduleInput}
              onChange={(e) => { setScheduleInput(e.target.value); setScheduleError(''); }}
              className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-1.5 text-white font-mono text-sm focus:outline-none focus:border-[#6366f1]"
              placeholder="0 5 * * *"
            />
            {scheduleError && <p className="text-red-400 text-xs">{scheduleError}</p>}
            {scheduleInput && !scheduleError && (
              <p className="text-[#6b7280] text-xs">{humanReadableSchedule(scheduleInput)}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const trimmed = scheduleInput.trim();
                  if (!/^\S+(\s+\S+){4}$/.test(trimmed)) {
                    setScheduleError('Must be a 5-field cron expression');
                    return;
                  }
                  setPendingAction('schedule');
                }}
                className="px-3 py-1 bg-[#6366f1] text-white text-xs rounded hover:bg-[#4f52c9] transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => { setEditingSchedule(false); setScheduleInput(job.schedule); setScheduleError(''); }}
                className="px-3 py-1 border border-[#1e1e2e] text-[#6b7280] text-xs rounded hover:text-white hover:border-[#3f3f5a] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div>
              <div className="text-white text-sm font-mono">{job.schedule}</div>
              <div className="text-[#6b7280] text-xs mt-0.5">{humanReadableSchedule(job.schedule)}</div>
            </div>
            <button
              onClick={() => { setEditingSchedule(true); setScheduleInput(job.schedule); }}
              className="ml-auto text-[#6b7280] text-xs hover:text-[#6366f1] transition-colors"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Agent & model */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[#6b7280] text-xs uppercase tracking-wide mb-1">Agent</div>
          <div className="text-white text-sm">{job.agentId}</div>
        </div>
        {job.modelOverride && (
          <div>
            <div className="text-[#6b7280] text-xs uppercase tracking-wide mb-1">Model Override</div>
            <div className="text-white text-sm font-mono truncate" title={job.modelOverride}>
              {job.modelOverride.replace('openrouter/', '')}
            </div>
          </div>
        )}
      </div>

      {/* Next run */}
      <div>
        <div className="text-[#6b7280] text-xs uppercase tracking-wide mb-1">Next Run</div>
        <div className="text-white text-sm">{computeNextRun(job.schedule)}</div>
      </div>

      {/* Last run */}
      {job.lastRun ? (
        <div>
          <div className="text-[#6b7280] text-xs uppercase tracking-wide mb-1">Last Run</div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${RUN_STATUS_BADGE[job.lastRun.status] ?? ''}`}>
              {job.lastRun.status}
            </span>
            <span className="text-[#6b7280] text-xs">{relativeTime(job.lastRun.startedAt)}</span>
            {job.lastRun.durationMs !== undefined && (
              <span className="text-[#4b5563] text-xs">{(job.lastRun.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="text-[#6b7280] text-xs uppercase tracking-wide mb-1">Last Run</div>
          <div className="text-[#4b5563] text-sm">No runs recorded</div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-1 border-t border-[#1e1e2e]">
        {/* Trigger */}
        <button
          disabled={triggerState === 'loading'}
          onClick={() => setPendingAction('trigger')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            triggerState === 'success'
              ? 'bg-emerald-500/20 text-emerald-400'
              : triggerState === 'error'
              ? 'bg-red-500/20 text-red-400'
              : triggerState === 'loading'
              ? 'bg-[#1e1e2e] text-[#6b7280] cursor-wait'
              : 'bg-[#6366f1] text-white hover:bg-[#4f52c9]'
          }`}
        >
          {triggerState === 'loading' ? '⟳ Running…' :
           triggerState === 'success' ? '✓ Triggered' :
           triggerState === 'error' ? '✕ Failed' :
           '▶ Run Now'}
        </button>

        {/* Enable / Disable toggle */}
        {job.status === 'disabled' ? (
          <button
            onClick={() => setPendingAction('enable')}
            className="px-3 py-1.5 rounded text-sm border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
          >
            Enable
          </button>
        ) : (
          <button
            onClick={() => setPendingAction('disable')}
            className="px-3 py-1.5 rounded text-sm border border-[#1e1e2e] text-[#6b7280] hover:text-red-400 hover:border-red-500/30 transition-colors"
          >
            Disable
          </button>
        )}

        {/* Run history */}
        <button
          onClick={onShowHistory}
          className="px-3 py-1.5 rounded text-sm border border-[#1e1e2e] text-[#6b7280] hover:text-white hover:border-[#3f3f5a] transition-colors ml-auto"
        >
          Run History →
        </button>
      </div>

      {/* Trigger error banner */}
      {triggerState === 'error' && triggerError && (
        <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs">
          {triggerError}
        </div>
      )}
    </div>
  );
}
