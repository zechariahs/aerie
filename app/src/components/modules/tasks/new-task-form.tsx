// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

import { useState } from 'react';
import type { Task, TaskCapabilityTier, TaskPriority, TaskTag } from '@/types';
import { basePath } from '@/lib/client-url';
import { clearTotpFreshCookieClient } from '@/lib/totp-fresh';

interface NewTaskFormProps {
  onCreated: (task: Task) => void;
  onCancel: () => void;
  onRequestTotp: (action: (token: string) => void) => void;
}

const inputStyle: React.CSSProperties = {
  background: 'var(--ae-raised)',
  border: '1px solid var(--ae-border)',
  color: 'var(--ae-text)',
  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  fontSize: 11,
  padding: '4px 6px',
  outline: 'none',
  width: '100%',
};

/**
 * Slide-over form for creating a new task.
 */
export function NewTaskForm({ onCreated, onCancel, onRequestTotp }: NewTaskFormProps): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('P3');
  const [tag, setTag] = useState<TaskTag | ''>('');
  const [assignedAgent, setAssignedAgent] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [capabilityTier, setCapabilityTier] = useState<TaskCapabilityTier>('default');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function doCreate(token: string): Promise<void> {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await fetch(basePath + '/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': token,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          tag: tag || undefined,
          assigned_agent: assignedAgent.trim() || undefined,
          due_date: dueDate || undefined,
          capability_tier: capabilityTier,
        }),
      });

      if (res.status === 403) {
        if (token === '') {
          clearTotpFreshCookieClient();
          onRequestTotp((t) => { void doCreate(t); });
        } else {
          setError('Invalid or expired TOTP code');
        }
        return;
      }
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        setError(err.error);
        return;
      }

      const json = (await res.json()) as { data: Task };
      onCreated(json.data);
    } catch {
      setError('Failed to create task');
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    onRequestTotp((token) => { void doCreate(token); });
  }

  const focusAmber = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)';
  };
  const blurBorder = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)';
  };

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onCancel} />

      {/* Panel */}
      <div className="w-96 flex flex-col" style={{ background: 'var(--ae-void)', borderLeft: '1px solid var(--ae-border)' }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--ae-border)' }}>
          <span className="ae-section-label">── New Task ─────────────</span>
          <button onClick={onCancel} className="text-[16px] leading-none" style={{ color: 'var(--ae-text2)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              style={inputStyle}
              placeholder="Task title"
              onFocus={focusAmber}
              onBlur={blurBorder}
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              style={{ ...inputStyle, resize: 'none' }}
              placeholder="Optional description"
              onFocus={focusAmber}
              onBlur={blurBorder}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                style={inputStyle}
                onFocus={focusAmber}
                onBlur={blurBorder}
              >
                <option value="P1">P1 — Critical</option>
                <option value="P2">P2 — High</option>
                <option value="P3">P3 — Normal</option>
                <option value="P4">P4 — Low</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Tag</label>
              <select
                value={tag}
                onChange={(e) => setTag(e.target.value as TaskTag | '')}
                style={inputStyle}
                onFocus={focusAmber}
                onBlur={blurBorder}
              >
                <option value="">None</option>
                <option value="Work">Work</option>
                <option value="Personal">Personal</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Agent</label>
              <input
                type="text"
                value={assignedAgent}
                onChange={(e) => setAssignedAgent(e.target.value)}
                placeholder="e.g. primary-agent"
                style={inputStyle}
                onFocus={focusAmber}
                onBlur={blurBorder}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={inputStyle}
                onFocus={focusAmber}
                onBlur={blurBorder}
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Capability Tier</label>
            <select
              value={capabilityTier}
              onChange={(e) => setCapabilityTier(e.target.value as TaskCapabilityTier)}
              style={inputStyle}
              onFocus={focusAmber}
              onBlur={blurBorder}
            >
              <option value="default">Default</option>
              <option value="fast">Fast</option>
              <option value="reasoning">Reasoning</option>
              <option value="auto">Auto</option>
            </select>
          </div>

          {error && <p className="text-[11px]" style={{ color: 'var(--ae-red)' }}>{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 text-[10px] uppercase tracking-[0.08em]"
              style={{
                padding: '5px 12px',
                background: 'transparent',
                border: '1px solid var(--ae-border-hi)',
                color: 'var(--ae-text2)',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 text-[10px] uppercase tracking-[0.08em] disabled:opacity-50"
              style={{
                padding: '5px 12px',
                background: 'var(--ae-amber)',
                border: 'none',
                color: 'var(--ae-void)',
              }}
            >
              {saving ? 'Creating…' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
