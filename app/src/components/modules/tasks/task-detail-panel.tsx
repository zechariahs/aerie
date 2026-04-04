// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Task, TaskPriority, TaskStatus, TaskTag, TaskStatusChange, TaskComment } from '@/types';
import { basePath } from '@/lib/client-url';
import { clearTotpFreshCookieClient } from '@/lib/totp-fresh';

interface TaskDetailData {
  task: Task;
  history: TaskStatusChange[];
  comments: TaskComment[];
}

interface TaskDetailPanelProps {
  taskId: string;
  onClose: () => void;
  onUpdated: (task: Task) => void;
  onDeleted: (id: string) => void;
  onRequestTotp: (action: (token: string) => void) => void;
}

const PRIORITY_OPTIONS: TaskPriority[] = ['P1', 'P2', 'P3', 'P4'];
const TAG_OPTIONS: Array<TaskTag | ''> = ['', 'Work', 'Personal', 'Other'];

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
 * Right-side detail panel for a selected task.
 * All edits are submitted inline with TOTP. Comments are also saved here.
 */
export function TaskDetailPanel({
  taskId,
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
  const [editResponses, setEditResponses] = useState<string[]>([]);
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
      setEditResponses(json.data.task.clarification_responses ?? []);
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
      if (res.status === 403) {
        if (token === '') { clearTotpFreshCookieClient(); onRequestTotp((t) => { void saveChanges(t); }); }
        else { showToast('Invalid or expired TOTP code'); }
        return;
      }
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
      if (res.status === 403) {
        if (token === '') { clearTotpFreshCookieClient(); onRequestTotp((t) => { void postComment(t); }); }
        else { showToast('Invalid or expired TOTP code'); }
        return;
      }
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
    if (res.status === 403) {
      if (token === '') { clearTotpFreshCookieClient(); onRequestTotp((t) => { void sendTelegram(t); }); }
      else { showToast('Invalid or expired TOTP code'); }
      return;
    }
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
    if (res.status === 403) {
      if (token === '') { clearTotpFreshCookieClient(); onRequestTotp((t) => { void sendDrive(t); }); }
      else { showToast('Invalid or expired TOTP code'); }
      return;
    }
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
    if (res.status === 403) {
      if (token === '') { clearTotpFreshCookieClient(); onRequestTotp((t) => { void handleDelete(t); }); }
      else { showToast('Invalid or expired TOTP code'); }
      return;
    }
    if (res.ok) {
      onDeleted(taskId);
    } else {
      showToast('Delete failed');
    }
  }

  async function submitResponses(token: string): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch(`${basePath}/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-TOTP-Token': token },
        body: JSON.stringify({
          clarification_responses: editResponses,
          clarification_state: 'resolved',
          status: 'inbox',
        }),
      });
      if (res.status === 403) {
        if (token === '') { clearTotpFreshCookieClient(); onRequestTotp((t) => { void submitResponses(t); }); }
        else { showToast('Invalid or expired TOTP code'); }
        return;
      }
      if (!res.ok) {
        showToast('Failed to submit responses');
        return;
      }
      const json = (await res.json()) as { data: Task };
      onUpdated(json.data);
      await fetchTask();
      showToast('Responses submitted');
    } catch {
      showToast('Failed to submit responses');
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickStatus(newStatus: TaskStatus, token: string): Promise<void> {
    const res = await fetch(`${basePath}/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-TOTP-Token': token },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.status === 403) {
      if (token === '') { clearTotpFreshCookieClient(); onRequestTotp((t) => { void handleQuickStatus(newStatus, t); }); }
      else { showToast('Invalid or expired TOTP code'); }
      return;
    }
    if (res.ok) {
      const json = (await res.json()) as { data: Task };
      onUpdated(json.data);
      await fetchTask();
      showToast(`Moved to ${newStatus}`);
    } else {
      showToast('Status update failed');
    }
  }

  const panelStyle: React.CSSProperties = {
    width: 320,
    flexShrink: 0,
    borderLeft: '1px solid var(--ae-border)',
    background: 'var(--ae-void)',
  };

  if (loading) {
    return (
      <div style={panelStyle} className="p-4">
        <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>Loading…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={panelStyle} className="p-4">
        <p className="text-[11px]" style={{ color: 'var(--ae-red)' }}>{error || 'Task not found'}</p>
        <button onClick={onClose} className="mt-2 text-[11px]" style={{ color: 'var(--ae-text2)', background: 'none', border: 'none', cursor: 'pointer' }}>Close</button>
      </div>
    );
  }

  const { task, history, comments } = data;

  return (
    <div style={panelStyle} className="flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--ae-border)' }}>
        <span className="ae-section-label">── Task Detail</span>
        <button onClick={onClose} className="text-[16px] leading-none" style={{ color: 'var(--ae-text2)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="mx-4 mt-2 px-3 py-1.5 text-[11px]" style={{ background: 'var(--ae-raised)', border: '1px solid var(--ae-border)', color: 'var(--ae-text)' }}>
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Title */}
        <div>
          <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Title</label>
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            style={inputStyle}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Description</label>
          <textarea
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: 'none' }}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
          />
        </div>

        {/* Priority & Tag */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Priority</label>
            <select
              value={editPriority}
              onChange={(e) => setEditPriority(e.target.value as TaskPriority)}
              style={inputStyle}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Tag</label>
            <select
              value={editTag}
              onChange={(e) => setEditTag(e.target.value as TaskTag | '')}
              style={inputStyle}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
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
            <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Agent</label>
            <input
              type="text"
              value={editAgent}
              onChange={(e) => setEditAgent(e.target.value)}
              placeholder="—"
              style={inputStyle}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Due</label>
            <input
              type="date"
              value={editDue}
              onChange={(e) => setEditDue(e.target.value)}
              style={inputStyle}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
            />
          </div>
        </div>

        {/* Drive link */}
        {task.linked_output && (
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Drive Doc</label>
            <a
              href={task.linked_output}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] no-underline hover:underline break-all"
              style={{ color: 'var(--ae-cyan)' }}
            >
              {task.linked_output}
            </a>
          </div>
        )}

        {/* Clarification Thread */}
        {task.clarification_questions && task.clarification_questions.length > 0 && (
          <div style={{ borderTop: '1px solid var(--ae-border)', paddingTop: 12 }}>
            <label className="block text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--ae-warn)' }}>
              ── Clarification Needed ────
            </label>
            <div className="space-y-2">
              {task.clarification_questions.map((q, i) => (
                <div key={i}>
                  <p className="text-[10px] mb-1" style={{ color: 'var(--ae-text2)' }}>Q{i + 1}: {q}</p>
                  <textarea
                    value={editResponses[i] ?? ''}
                    onChange={(e) => {
                      const next = [...editResponses];
                      next[i] = e.target.value;
                      setEditResponses(next);
                    }}
                    rows={2}
                    placeholder="Your answer…"
                    style={{ ...inputStyle, resize: 'none' }}
                    onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
                    onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
                  />
                </div>
              ))}
            </div>
            <button
              disabled={
                saving ||
                task.clarification_state === 'resolved' ||
                !(task.clarification_questions ?? []).every((_, idx) => (editResponses[idx] ?? '').trim() !== '')
              }
              onClick={() => onRequestTotp((token) => { void submitResponses(token); })}
              className="w-full text-[10px] uppercase tracking-[0.08em] disabled:opacity-40 mt-2"
              style={{
                padding: '4px 8px',
                background: 'transparent',
                border: '1px solid var(--ae-border-hi)',
                color: 'var(--ae-text2)',
              }}
            >
              Submit Responses
            </button>
          </div>
        )}

        {/* Execution Info */}
        {task.execution_session_id && (
          <div style={{ borderTop: '1px solid var(--ae-border)', paddingTop: 12 }}>
            <label className="block text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--ae-text3)' }}>
              ── Execution ───────────────
            </label>
            <div className="space-y-1">
              <div className="text-[10px]">
                <span style={{ color: 'var(--ae-text3)' }}>Session: </span>
                <span style={{ color: 'var(--ae-text2)' }}>{task.execution_session_id}</span>
              </div>
              <div className="text-[10px]">
                <span style={{ color: 'var(--ae-text3)' }}>Summary: </span>
                <span style={{ color: 'var(--ae-text2)' }}>{task.output_summary ?? '—'}</span>
              </div>
              <div className="text-[10px]">
                <span style={{ color: 'var(--ae-text3)' }}>Artifact: </span>
                {task.output_artifact_url ? (
                  /^https?:\/\//i.test(task.output_artifact_url) ? (
                    <a
                      href={task.output_artifact_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="no-underline hover:underline break-all"
                      style={{ color: 'var(--ae-cyan)' }}
                    >
                      {task.output_artifact_url}
                    </a>
                  ) : (
                    <span className="break-all" style={{ color: 'var(--ae-text2)' }}>{task.output_artifact_url}</span>
                  )
                ) : (
                  <span style={{ color: 'var(--ae-text2)' }}>—</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Save button */}
        <button
          disabled={saving}
          onClick={() => onRequestTotp((token) => { void saveChanges(token); })}
          className="w-full text-[10px] uppercase tracking-[0.08em] disabled:opacity-50"
          style={{
            padding: '5px 12px',
            background: 'var(--ae-amber)',
            border: 'none',
            color: 'var(--ae-void)',
          }}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>

        {/* Quick actions */}
        <div className="flex gap-2">
          {task.status !== 'done' && (
            <button
              onClick={() => onRequestTotp((token) => { void handleQuickStatus('done', token); })}
              className="flex-1 text-[10px] uppercase tracking-[0.08em]"
              style={{
                padding: '4px 8px',
                background: 'transparent',
                border: '1px solid var(--ae-green-dim)',
                color: 'var(--ae-green)',
              }}
            >
              Mark Done
            </button>
          )}
          {task.status !== 'archived' && (
            <button
              onClick={() => onRequestTotp((token) => { void handleQuickStatus('archived', token); })}
              className="flex-1 text-[10px] uppercase tracking-[0.08em]"
              style={{
                padding: '4px 8px',
                background: 'transparent',
                border: '1px solid var(--ae-border-hi)',
                color: 'var(--ae-text2)',
              }}
            >
              Archive
            </button>
          )}
        </div>

        {/* Integrations */}
        <div className="flex gap-2 pt-1" style={{ borderTop: '1px solid var(--ae-border)' }}>
          <button
            onClick={() => onRequestTotp((token) => { void sendTelegram(token); })}
            className="flex-1 text-[10px] uppercase tracking-[0.08em]"
            style={{
              padding: '4px 8px',
              background: 'transparent',
              border: '1px solid var(--ae-border-hi)',
              color: 'var(--ae-text2)',
            }}
          >
            Send Telegram
          </button>
          <button
            onClick={() => onRequestTotp((token) => { void sendDrive(token); })}
            className="flex-1 text-[10px] uppercase tracking-[0.08em]"
            style={{
              padding: '4px 8px',
              background: 'transparent',
              border: '1px solid var(--ae-border-hi)',
              color: 'var(--ae-text2)',
            }}
          >
            Write to Drive
          </button>
        </div>

        {/* Status history */}
        {history.length > 0 && (
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--ae-text3)' }}>History</label>
            <div className="space-y-1">
              {history.map((h) => (
                <div key={h.id} className="text-[10px]" style={{ color: 'var(--ae-text3)' }}>
                  <span>{h.from_status ?? 'new'}</span>
                  <span className="mx-1">→</span>
                  <span style={{ color: 'var(--ae-text2)' }}>{h.to_status}</span>
                  <span className="ml-2">{new Date(h.changed_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comments */}
        <div>
          <label className="block text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--ae-text3)' }}>
            Comments ({comments.length})
          </label>
          <div className="space-y-2 mb-2">
            {comments.map((c) => (
              <div key={c.id} className="text-[10px] p-2" style={{ background: 'var(--ae-raised)', border: '1px solid var(--ae-border)' }}>
                <p className="whitespace-pre-wrap" style={{ color: 'var(--ae-text)' }}>{c.body}</p>
                <p className="mt-1" style={{ color: 'var(--ae-text3)' }}>{new Date(c.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Add a comment…"
            style={{ ...inputStyle, resize: 'none', marginBottom: 4 }}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
          />
          <button
            disabled={!comment.trim() || saving}
            onClick={() => onRequestTotp((token) => { void postComment(token); })}
            className="w-full text-[10px] uppercase tracking-[0.08em] disabled:opacity-40"
            style={{
              padding: '4px 8px',
              background: 'transparent',
              border: '1px solid var(--ae-border-hi)',
              color: 'var(--ae-text2)',
            }}
          >
            Add Comment
          </button>
        </div>

        {/* Delete */}
        <div className="pt-2" style={{ borderTop: '1px solid var(--ae-border)' }}>
          <button
            onClick={() => onRequestTotp((token) => { void handleDelete(token); })}
            className="w-full text-[10px] uppercase tracking-[0.08em]"
            style={{
              padding: '4px 8px',
              background: 'transparent',
              border: '1px solid var(--ae-red-dim)',
              color: 'var(--ae-red)',
            }}
          >
            Delete Task
          </button>
        </div>
      </div>
    </div>
  );
}
