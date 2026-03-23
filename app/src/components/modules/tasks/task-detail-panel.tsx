// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Task, TaskPriority, TaskStatus, TaskTag, TaskStatusChange, TaskComment } from '@/types';
import { basePath } from '@/lib/client-url';

interface TaskDetailData {
  task: Task;
  history: TaskStatusChange[];
  comments: TaskComment[];
}

interface TaskDetailPanelProps {
  taskId: string;
  totpToken: string;
  onClose: () => void;
  onUpdated: (task: Task) => void;
  onDeleted: (id: string) => void;
  onRequestTotp: (action: () => void) => void;
}

const PRIORITY_OPTIONS: TaskPriority[] = ['P1', 'P2', 'P3', 'P4'];
const TAG_OPTIONS: Array<TaskTag | ''> = ['', 'Work', 'Personal', 'Other'];
const PRIORITY_COLORS: Record<string, string> = {
  P1: 'text-red-400',
  P2: 'text-orange-400',
  P3: 'text-blue-400',
  P4: 'text-[#6b7280]',
};

/**
 * Right-side detail panel for a selected task.
 * All edits are submitted inline with TOTP. Comments are also saved here.
 */
export function TaskDetailPanel({
  taskId,
  totpToken,
  onClose,
  onUpdated,
  onDeleted,
  onRequestTotp,
}: TaskDetailPanelProps): React.JSX.Element {
  const [data, setData] = useState<TaskDetailData | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPriority, setEditPriority] = useState<TaskPriority>('P3');
  const [editTag, setEditTag] = useState<TaskTag | ''>('');
  const [editAgent, setEditAgent] = useState('');
  const [editDue, setEditDue] = useState('');
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const fetchTask = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${basePath}/api/tasks/${taskId}`);
      if (!res.ok) {
        setError('Failed to load task');
        return;
      }
      const json = (await res.json()) as { data: TaskDetailData };
      setData(json.data);
      setEditTitle(json.data.task.title);
      setEditDesc(json.data.task.description ?? '');
      setEditPriority(json.data.task.priority);
      setEditTag(json.data.task.tag ?? '');
      setEditAgent(json.data.task.assigned_agent ?? '');
      setEditDue(json.data.task.due_date ?? '');
    } catch {
      setError('Failed to load task');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void fetchTask();
  }, [fetchTask]);

  async function saveChanges(token: string): Promise<void> {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch(`${basePath}/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': token,
        },
        body: JSON.stringify({
          title: editTitle,
          description: editDesc || undefined,
          priority: editPriority,
          tag: editTag || null,
          assigned_agent: editAgent || null,
          due_date: editDue || null,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        showToast(`Error: ${err.error}`);
        return;
      }
      const json = (await res.json()) as { data: Task };
      onUpdated(json.data);
      await fetchTask();
      showToast('Saved');
    } catch {
      showToast('Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function postComment(token: string): Promise<void> {
    if (!comment.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${basePath}/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': token,
        },
        body: JSON.stringify({ comment: comment.trim() }),
      });
      if (!res.ok) {
        showToast('Failed to post comment');
        return;
      }
      setComment('');
      await fetchTask();
      showToast('Comment added');
    } catch {
      showToast('Failed to post comment');
    } finally {
      setSaving(false);
    }
  }

  async function sendTelegram(token: string): Promise<void> {
    const res = await fetch(`${basePath}/api/tasks/${taskId}/send-telegram`, {
      method: 'POST',
      headers: { 'X-TOTP-Token': token },
    });
    if (res.ok) {
      showToast('Sent to Telegram');
    } else {
      const err = (await res.json()) as { error: string };
      showToast(`Telegram error: ${err.error}`);
    }
  }

  async function sendDrive(token: string): Promise<void> {
    const res = await fetch(`${basePath}/api/tasks/${taskId}/send-drive`, {
      method: 'POST',
      headers: { 'X-TOTP-Token': token },
    });
    if (res.ok) {
      showToast('Written to Drive');
      await fetchTask();
    } else {
      const err = (await res.json()) as { error: string };
      showToast(`Drive error: ${err.error}`);
    }
  }

  async function handleDelete(token: string): Promise<void> {
    const res = await fetch(`${basePath}/api/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { 'X-TOTP-Token': token },
    });
    if (res.ok) {
      onDeleted(taskId);
    } else {
      showToast('Delete failed');
    }
  }

  async function handleQuickStatus(newStatus: TaskStatus, token: string): Promise<void> {
    const res = await fetch(`${basePath}/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-TOTP-Token': token },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      const json = (await res.json()) as { data: Task };
      onUpdated(json.data);
      await fetchTask();
      showToast(`Moved to ${newStatus}`);
    } else {
      showToast('Status update failed');
    }
  }

  if (loading) {
    return (
      <div className="w-80 flex-shrink-0 border-l border-[#1e1e2e] bg-[#0d0d14] p-4">
        <p className="text-xs text-[#6b7280]">Loading…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-80 flex-shrink-0 border-l border-[#1e1e2e] bg-[#0d0d14] p-4">
        <p className="text-xs text-red-400">{error || 'Task not found'}</p>
        <button onClick={onClose} className="mt-2 text-xs text-[#6b7280] hover:text-white">Close</button>
      </div>
    );
  }

  const { task, history, comments } = data;

  return (
    <div className="w-80 flex-shrink-0 border-l border-[#1e1e2e] bg-[#0d0d14] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e]">
        <span className="text-xs font-semibold text-[#6b7280] uppercase tracking-widest">Task Detail</span>
        <button onClick={onClose} className="text-[#6b7280] hover:text-white text-lg leading-none">×</button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="mx-4 mt-2 px-3 py-1.5 bg-[#1e1e2e] rounded text-xs text-white border border-[#374151]">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Title */}
        <div>
          <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Title</label>
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white focus:outline-none focus:border-[#3b82f6]"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Description</label>
          <textarea
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            rows={4}
            className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white focus:outline-none focus:border-[#3b82f6] resize-none"
          />
        </div>

        {/* Priority & Tag */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Priority</label>
            <select
              value={editPriority}
              onChange={(e) => setEditPriority(e.target.value as TaskPriority)}
              className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white focus:outline-none"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p} className={PRIORITY_COLORS[p]}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Tag</label>
            <select
              value={editTag}
              onChange={(e) => setEditTag(e.target.value as TaskTag | '')}
              className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white focus:outline-none"
            >
              {TAG_OPTIONS.map((t) => (
                <option key={t} value={t}>{t || '—'}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Agent & Due Date */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Agent</label>
            <input
              type="text"
              value={editAgent}
              onChange={(e) => setEditAgent(e.target.value)}
              placeholder="—"
              className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white focus:outline-none focus:border-[#3b82f6]"
            />
          </div>
          <div>
            <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Due</label>
            <input
              type="date"
              value={editDue}
              onChange={(e) => setEditDue(e.target.value)}
              className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white focus:outline-none focus:border-[#3b82f6]"
            />
          </div>
        </div>

        {/* Drive link */}
        {task.linked_output && (
          <div>
            <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-1">Drive Doc</label>
            <a
              href={task.linked_output}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#3b82f6] hover:underline break-all"
            >
              {task.linked_output}
            </a>
          </div>
        )}

        {/* Save button */}
        <button
          disabled={saving}
          onClick={() => onRequestTotp(() => { void saveChanges(totpToken); })}
          className="w-full py-1.5 text-xs text-white bg-[#3b82f6] rounded hover:bg-[#2563eb] disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>

        {/* Quick actions */}
        <div className="flex gap-2">
          {task.status !== 'done' && (
            <button
              onClick={() => onRequestTotp(() => { void handleQuickStatus('done', totpToken); })}
              className="flex-1 py-1 text-[10px] text-green-400 border border-green-900/50 rounded hover:bg-green-900/20 transition-colors"
            >
              Mark Done
            </button>
          )}
          {task.status !== 'archived' && (
            <button
              onClick={() => onRequestTotp(() => { void handleQuickStatus('archived', totpToken); })}
              className="flex-1 py-1 text-[10px] text-[#6b7280] border border-[#1e1e2e] rounded hover:text-white transition-colors"
            >
              Archive
            </button>
          )}
        </div>

        {/* Integrations */}
        <div className="flex gap-2 pt-1 border-t border-[#1e1e2e]">
          <button
            onClick={() => onRequestTotp(() => { void sendTelegram(totpToken); })}
            className="flex-1 py-1 text-[10px] text-[#6b7280] border border-[#1e1e2e] rounded hover:text-white transition-colors"
          >
            Send Telegram
          </button>
          <button
            onClick={() => onRequestTotp(() => { void sendDrive(totpToken); })}
            className="flex-1 py-1 text-[10px] text-[#6b7280] border border-[#1e1e2e] rounded hover:text-white transition-colors"
          >
            Write to Drive
          </button>
        </div>

        {/* Status history */}
        {history.length > 0 && (
          <div>
            <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-2">History</label>
            <div className="space-y-1">
              {history.map((h) => (
                <div key={h.id} className="text-[10px] text-[#4b5563]">
                  <span>{h.from_status ?? 'new'}</span>
                  <span className="mx-1">→</span>
                  <span className="text-[#9ca3af]">{h.to_status}</span>
                  <span className="ml-2 text-[#374151]">{new Date(h.changed_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comments */}
        <div>
          <label className="block text-[10px] text-[#6b7280] uppercase tracking-widest mb-2">
            Comments ({comments.length})
          </label>
          <div className="space-y-2 mb-2">
            {comments.map((c) => (
              <div key={c.id} className="text-[10px] bg-[#12121a] border border-[#1e1e2e] rounded p-2">
                <p className="text-[#d1d5db] whitespace-pre-wrap">{c.body}</p>
                <p className="text-[#374151] mt-1">{new Date(c.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Add a comment…"
            className="w-full px-2 py-1.5 bg-[#12121a] border border-[#1e1e2e] rounded text-xs text-white placeholder-[#4b5563] focus:outline-none focus:border-[#3b82f6] resize-none mb-1"
          />
          <button
            disabled={!comment.trim() || saving}
            onClick={() => onRequestTotp(() => { void postComment(totpToken); })}
            className="w-full py-1 text-[10px] text-[#6b7280] border border-[#1e1e2e] rounded hover:text-white disabled:opacity-40 transition-colors"
          >
            Add Comment
          </button>
        </div>

        {/* Delete */}
        <div className="pt-2 border-t border-[#1e1e2e]">
          <button
            onClick={() => onRequestTotp(() => { void handleDelete(totpToken); })}
            className="w-full py-1 text-[10px] text-red-500 border border-red-900/30 rounded hover:bg-red-900/20 transition-colors"
          >
            Delete Task
          </button>
        </div>
      </div>
    </div>
  );
}
