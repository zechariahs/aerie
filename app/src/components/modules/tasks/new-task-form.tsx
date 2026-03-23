// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

import { useState } from 'react';
import type { Task, TaskPriority, TaskTag } from '@/types';
import { basePath } from '@/lib/client-url';

interface NewTaskFormProps {
  totpToken: string;
  onCreated: (task: Task) => void;
  onCancel: () => void;
  onRequestTotp: (action: () => void) => void;
}

/**
 * Slide-over form for creating a new task.
 */
export function NewTaskForm({ totpToken, onCreated, onCancel, onRequestTotp }: NewTaskFormProps): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('P3');
  const [tag, setTag] = useState<TaskTag | ''>('');
  const [assignedAgent, setAssignedAgent] = useState('');
  const [dueDate, setDueDate] = useState('');
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
        }),
      });

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
    onRequestTotp(() => { void doCreate(totpToken); });
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50" onClick={onCancel} />

      {/* Panel */}
      <div className="w-96 bg-[#0d0d14] border-l border-[#1e1e2e] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e]">
          <span className="text-xs font-semibold text-white">New Task</span>
          <button onClick={onCancel} className="text-[#6b7280] hover:text-white text-lg leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div>
            <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white focus:outline-none focus:border-[#3b82f6]"
              placeholder="Task title"
            />
          </div>

          <div>
            <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white focus:outline-none focus:border-[#3b82f6] resize-none"
              placeholder="Optional description"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white focus:outline-none"
              >
                <option value="P1">P1 — Critical</option>
                <option value="P2">P2 — High</option>
                <option value="P3">P3 — Normal</option>
                <option value="P4">P4 — Low</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Tag</label>
              <select
                value={tag}
                onChange={(e) => setTag(e.target.value as TaskTag | '')}
                className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white focus:outline-none"
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
              <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Agent</label>
              <input
                type="text"
                value={assignedAgent}
                onChange={(e) => setAssignedAgent(e.target.value)}
                placeholder="e.g. primary-agent"
                className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white focus:outline-none focus:border-[#3b82f6]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white focus:outline-none focus:border-[#3b82f6]"
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-1.5 text-xs text-[#6b7280] border border-[#1e1e2e] rounded hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-1.5 text-xs text-white bg-[#3b82f6] rounded hover:bg-[#2563eb] disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating…' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
