// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' — uses event handlers, state, and fetches
'use client';

import { useState } from 'react';
import cronstrue from 'cronstrue';
import { CronExpressionParser } from 'cron-parser';
import type { CronJob } from '@/types';
import TotpDialog from './totp-dialog';
import { basePath } from '@/lib/client-url';
import { isTotpFresh } from '@/lib/totp-fresh';

const TZ = 'America/Chicago';

interface CronJobPanelProps {
  job: CronJob;
  onShowHistory: () => void;
  onJobUpdated: () => void;
}

type DialogAction = 'trigger' | 'enable' | 'disable' | 'schedule' | 'prompt';

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

function cronStatusBadge(status: CronJob['status']): { cls: string; label: string } {
  switch (status) {
    case 'active':   return { cls: 'ae-badge ae-badge-active', label: 'ACTIVE'   };
    case 'disabled': return { cls: 'ae-badge ae-badge-off',    label: 'DISABLED' };
    case 'running':  return { cls: 'ae-badge ae-badge-active', label: 'RUNNING'  };
  }
}

function runStatusBadge(status: string): string {
  switch (status) {
    case 'success': return 'ae-badge ae-badge-ok';
    case 'failure': return 'ae-badge ae-badge-error';
    case 'running': return 'ae-badge ae-badge-active';
    default:        return 'ae-badge ae-badge-off';
  }
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '10px',
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: 'var(--ae-text2)',
  marginBottom: '4px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--ae-raised)',
  border: '1px solid var(--ae-border)',
  color: 'var(--ae-text)',
  fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
  fontSize: '12px',
  padding: '6px 10px',
  outline: 'none',
};

const btnPrimary: React.CSSProperties = {
  fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '5px 12px',
  background: 'var(--ae-amber)',
  color: 'var(--ae-void)',
  border: 'none',
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '5px 12px',
  background: 'transparent',
  border: '1px solid var(--ae-border-hi)',
  color: 'var(--ae-text2)',
  cursor: 'pointer',
};

export default function CronJobPanel({ job, onShowHistory, onJobUpdated }: CronJobPanelProps): React.JSX.Element {
  const scheduleTz = job.scheduleTz ?? 'America/Chicago';
  const [pendingAction, setPendingAction] = useState<DialogAction | undefined>();
  const [triggerState, setTriggerState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [triggerError, setTriggerError] = useState('');
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleInput, setScheduleInput] = useState(job.schedule);
  const [scheduleError, setScheduleError] = useState('');
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptInput, setPromptInput] = useState(job.prompt?.trim() ?? '');
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
      const res = await fetch(`${basePath}/api/crons/${job.id}/trigger`, {
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
      setTimeout(() => setTriggerState('idle'), 4000);
    } catch {
      setTriggerState('error');
      setTriggerError('Network error');
    }
  }

  async function handleSetEnabled(totpToken: string, enabled: boolean): Promise<void> {
    setPendingAction(undefined);
    try {
      const res = await fetch(`${basePath}/api/crons/${job.id}`, {
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
      const res = await fetch(`${basePath}/api/crons/${job.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': totpToken,
        },
        body: JSON.stringify({ schedule: trimmed, scheduleTz }),
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

  async function handleSavePrompt(totpToken: string): Promise<void> {
    setPendingAction(undefined);
    const trimmed = promptInput.trim();
    try {
      const res = await fetch(`${basePath}/api/crons/${job.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': totpToken,
        },
        body: JSON.stringify({ prompt: trimmed }),
      });
      if (!res.ok) {
        const err = (await res.json()) as ApiError;
        showToast(`Error: ${err.error ?? 'Update failed'}`);
        return;
      }
      setEditingPrompt(false);
      showToast('Prompt updated');
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
    else if (pendingAction === 'prompt') void handleSavePrompt(totpToken);
  }

  /** Opens the TOTP dialog for a cron action — or runs it immediately if TOTP is still fresh. */
  function requestAction(action: DialogAction): void {
    if (isTotpFresh()) {
      if (action === 'trigger') void handleTrigger('');
      else if (action === 'enable') void handleSetEnabled('', true);
      else if (action === 'disable') void handleSetEnabled('', false);
      else if (action === 'schedule') void handleSaveSchedule('');
      else if (action === 'prompt') void handleSavePrompt('');
      return;
    }
    setPendingAction(action);
  }

  const statusBadge = cronStatusBadge(job.status);

  return (
    <div
      className="space-y-5 p-5"
      style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-border)' }}
    >
      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 text-[11px] px-4 py-2 shadow-lg"
          style={{
            background: 'var(--ae-raised)',
            border: '1px solid var(--ae-border-hi)',
            color: 'var(--ae-text)',
          }}
        >
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
            pendingAction === 'prompt' ? 'Confirm Prompt Change' :
            'Confirm Schedule Change'
          }
          description={
            pendingAction === 'trigger' ? `Run "${job.name}" now?` :
            pendingAction === 'enable' ? `Enable "${job.name}"?` :
            pendingAction === 'disable' ? `Disable "${job.name}"?` :
            pendingAction === 'prompt' ? `Update the prompt for "${job.name}"?` :
            `Change schedule to: ${scheduleInput.trim()}`
          }
          onConfirm={handleDialogConfirm}
          onCancel={() => setPendingAction(undefined)}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[13px]" style={{ color: 'var(--ae-text)' }}>{job.name}</h2>
          <div className="text-[10px] mt-[2px]" style={{ color: 'var(--ae-text2)' }}>{job.id}</div>
        </div>
        <span className={statusBadge.cls}>{statusBadge.label}</span>
      </div>

      {/* Schedule */}
      <div className="space-y-1.5">
        <div style={fieldLabelStyle}>Schedule</div>
        {editingSchedule ? (
          <div className="space-y-2">
            <input
              type="text"
              value={scheduleInput}
              onChange={(e) => { setScheduleInput(e.target.value); setScheduleError(''); }}
              style={{ ...inputStyle }}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber-dim)'; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
              placeholder="0 5 * * *"
            />
            {scheduleError && (
              <p className="text-[10px]" style={{ color: 'var(--ae-red)' }}>{scheduleError}</p>
            )}
            {scheduleInput && !scheduleError && (
              <p className="text-[10px]" style={{ color: 'var(--ae-text2)' }}>{humanReadableSchedule(scheduleInput)}</p>
            )}
            <div className="flex gap-2">
              <button
                style={btnPrimary}
                onClick={() => {
                  const trimmed = scheduleInput.trim();
                  if (!/^\S+(\s+\S+){4}$/.test(trimmed)) {
                    setScheduleError('Must be a 5-field cron expression');
                    return;
                  }
                  requestAction('schedule');
                }}
              >
                Save
              </button>
              <button
                style={btnSecondary}
                onClick={() => { setEditingSchedule(false); setScheduleInput(job.schedule); setScheduleError(''); }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div>
              <div className="text-[12px]" style={{ color: 'var(--ae-text)' }}>{job.schedule}</div>
              <div className="text-[10px] mt-[2px]" style={{ color: 'var(--ae-text2)' }}>{humanReadableSchedule(job.schedule)}</div>
            </div>
            <button
              className="ml-auto text-[10px] uppercase tracking-[0.06em] transition-colors"
              style={{ color: 'var(--ae-text2)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-amber)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text2)'; }}
              onClick={() => { setEditingSchedule(true); setScheduleInput(job.schedule); }}
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Agent & model */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div style={fieldLabelStyle}>Agent</div>
          <div className="text-[12px]" style={{ color: 'var(--ae-text)' }}>{job.agentId}</div>
        </div>
        {job.modelOverride && (
          <div>
            <div style={fieldLabelStyle}>Model Override</div>
            <div className="text-[12px] truncate" style={{ color: 'var(--ae-text)' }} title={job.modelOverride}>
              {job.modelOverride.replace('openrouter/', '')}
            </div>
          </div>
        )}
      </div>

      {/* Prompt */}
      <div className="space-y-1.5">
        <div style={fieldLabelStyle}>Prompt</div>
        {editingPrompt ? (
          <div className="space-y-2">
            <textarea
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              rows={6}
              style={{ ...inputStyle, resize: 'vertical' }}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber-dim)'; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
            />
            <div className="flex gap-2">
              <button
                disabled={promptInput.trim() === (job.prompt ?? '')}
                onClick={() => requestAction('prompt')}
                style={{
                  ...btnPrimary,
                  opacity: promptInput.trim() === (job.prompt ?? '') ? 0.4 : 1,
                  cursor: promptInput.trim() === (job.prompt ?? '') ? 'not-allowed' : 'pointer',
                }}
              >
                Save
              </button>
              <button
                style={btnSecondary}
                onClick={() => { setEditingPrompt(false); setPromptInput(job.prompt?.trim() ?? ''); }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            {job.prompt ? (
              <pre
                className="flex-1 whitespace-pre-wrap overflow-auto max-h-48 text-[12px] leading-relaxed"
                style={{ color: 'var(--ae-text)' }}
              >
                {job.prompt}
              </pre>
            ) : (
              <span className="text-[12px]" style={{ color: 'var(--ae-text3)' }}>No prompt set</span>
            )}
            <button
              className="shrink-0 text-[10px] uppercase tracking-[0.06em] transition-colors"
              style={{ color: 'var(--ae-text2)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-amber)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text2)'; }}
              onClick={() => { setEditingPrompt(true); setPromptInput(job.prompt?.trim() ?? ''); }}
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Next run */}
      <div>
        <div style={fieldLabelStyle}>Next Run</div>
        <div className="text-[12px]" style={{ color: 'var(--ae-text)' }}>{computeNextRun(job.schedule)}</div>
      </div>

      {/* Last run */}
      {job.lastRun ? (
        <div>
          <div style={fieldLabelStyle}>Last Run</div>
          <div className="flex items-center gap-2">
            <span className={runStatusBadge(job.lastRun.status)}>{job.lastRun.status}</span>
            <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>{relativeTime(job.lastRun.startedAt)}</span>
            {job.lastRun.durationMs !== undefined && (
              <span className="text-[10px]" style={{ color: 'var(--ae-text3)' }}>
                {(job.lastRun.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div style={fieldLabelStyle}>Last Run</div>
          <div className="text-[12px]" style={{ color: 'var(--ae-text3)' }}>No runs recorded</div>
        </div>
      )}

      {/* Actions */}
      <div
        className="flex flex-wrap gap-2 pt-3"
        style={{ borderTop: '1px solid var(--ae-border)' }}
      >
        {/* Trigger */}
        <button
          disabled={triggerState === 'loading'}
          onClick={() => requestAction('trigger')}
          className="text-[10px] uppercase tracking-[0.08em] px-[12px] py-[5px] transition-opacity"
          style={{
            fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
            ...(triggerState === 'success'
              ? { background: 'transparent', border: '1px solid var(--ae-green-dim)', color: 'var(--ae-green)' }
              : triggerState === 'error'
              ? { background: 'transparent', border: '1px solid var(--ae-red-dim)', color: 'var(--ae-red)' }
              : triggerState === 'loading'
              ? { background: 'var(--ae-raised)', border: '1px solid var(--ae-border)', color: 'var(--ae-text3)', cursor: 'wait' }
              : { background: 'var(--ae-amber)', border: 'none', color: 'var(--ae-void)', cursor: 'pointer' }
            ),
          }}
        >
          {triggerState === 'loading' ? '⟳ Running…' :
           triggerState === 'success' ? '✓ Triggered' :
           triggerState === 'error' ? '✕ Failed' :
           '▶ Run Now'}
        </button>

        {/* Enable / Disable toggle */}
        {job.status === 'disabled' ? (
          <button
            style={btnSecondary}
            onClick={() => requestAction('enable')}
          >
            Enable
          </button>
        ) : (
          <button
            style={btnSecondary}
            onClick={() => requestAction('disable')}
          >
            Disable
          </button>
        )}

        {/* Run history */}
        <button
          style={{ ...btnSecondary, marginLeft: 'auto' }}
          onClick={onShowHistory}
        >
          Run History →
        </button>
      </div>

      {/* Trigger error banner */}
      {triggerState === 'error' && triggerError && (
        <div
          className="p-2 text-[11px]"
          style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-red-dim)', color: 'var(--ae-red)' }}
        >
          {triggerError}
        </div>
      )}
    </div>
  );
}
