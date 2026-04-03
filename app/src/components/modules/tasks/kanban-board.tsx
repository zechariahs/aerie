// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DragDropContext, Droppable, type DropResult } from '@hello-pangea/dnd';
import { TaskCard } from './task-card';
import { TaskDetailPanel } from './task-detail-panel';
import { NewTaskForm } from './new-task-form';
import { TotpDialog } from './totp-dialog';
import { TaskSpecsInbox } from './task-specs-inbox';
import type { Task, TaskStatus } from '@/types';
import { basePath } from '@/lib/client-url';
import { isTotpFresh, clearTotpFreshCookieClient } from '@/lib/totp-fresh';

type TasksByColumn = Record<TaskStatus, Task[]>;

const COLUMN_LABELS: Record<TaskStatus, string> = {
  inbox: 'Inbox',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  needs_clarification: 'NEEDS INPUT',
  review: 'Review',
  done: 'Done',
  archived: 'Archived',
};

const VISIBLE_COLUMNS: TaskStatus[] = ['inbox', 'assigned', 'in_progress', 'needs_clarification', 'review', 'done'];

/**
 * Full Kanban board with drag-and-drop, task detail panel, and new-task form.
 * TOTP is collected once per write action via the TotpDialog.
 */
export function KanbanBoard(): React.JSX.Element {
  const [tasks, setTasks] = useState<TasksByColumn>({
    inbox: [], assigned: [], in_progress: [], needs_clarification: [], review: [], done: [], archived: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [showArchived, setShowArchived] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [showArchiveColumn, setShowArchiveColumn] = useState(false);

  // TOTP dialog state
  const [totpOpen, setTotpOpen] = useState(false);
  const [totpToken, setTotpToken] = useState('');
  const pendingActionRef = useRef<((token: string) => void) | undefined>(undefined);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${basePath}/api/tasks?showArchived=${showArchived ? '1' : '0'}`);
      if (!res.ok) {
        setError('Failed to load tasks');
        return;
      }
      const json = (await res.json()) as { data: TasksByColumn };
      setTasks(json.data);
    } catch {
      setError('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  /**
   * Opens the TOTP dialog — or runs the action immediately if TOTP is still fresh.
   * Always stores the action so a 403 fallback can re-open the dialog.
   * The action receives the token string ('' when fresh, dialog value otherwise).
   */
  function requestTotp(action: (token: string) => void): void {
    pendingActionRef.current = action;
    if (isTotpFresh()) {
      action('');
      return;
    }
    setTotpOpen(true);
  }

  function onTotpConfirm(token: string): void {
    setTotpToken(token);
    setTotpOpen(false);
    if (pendingActionRef.current) {
      pendingActionRef.current(token);
      pendingActionRef.current = undefined;
    }
  }

  function onTotpCancel(): void {
    setTotpOpen(false);
    if (pendingActionRef.current) {
      // Revert any optimistic board update that was applied before the dialog opened.
      void fetchTasks();
    }
    pendingActionRef.current = undefined;
  }

  async function doMove(taskId: string, newStatus: TaskStatus, token: string): Promise<void> {
    const res = await fetch(`${basePath}/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-TOTP-Token': token },
      body: JSON.stringify({ status: newStatus }),
    });

    if (res.status === 403) {
      if (token.trim().length === 0) {
        // Empty token: server grace period reset (e.g. process restart). Clear
        // stale cookie and re-open dialog — pendingActionRef still set.
        clearTotpFreshCookieClient();
        setTotpOpen(true);
      } else {
        // Real TOTP was rejected — invalid/expired code. Revert optimistic update.
        await fetchTasks();
      }
      return;
    }

    if (!res.ok) {
      // Revert optimistic update
      await fetchTasks();
      return;
    }
    // The optimistic update is already applied; just confirm
  }

  function onDragEnd(result: DropResult): void {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    const srcCol = source.droppableId as TaskStatus;
    const dstCol = destination.droppableId as TaskStatus;

    if (srcCol === dstCol && source.index === destination.index) return;

    // Optimistic update
    setTasks((prev) => {
      const next = { ...prev };
      const srcList = [...prev[srcCol]];
      const [moved] = srcList.splice(source.index, 1);
      if (!moved) return prev;

      const updatedTask = { ...moved, status: dstCol };
      if (srcCol === dstCol) {
        srcList.splice(destination.index, 0, updatedTask);
        next[srcCol] = srcList;
      } else {
        const dstList = [...prev[dstCol]];
        dstList.splice(destination.index, 0, updatedTask);
        next[srcCol] = srcList;
        next[dstCol] = dstList;
      }
      return next;
    });

    // Require TOTP if column actually changed
    if (srcCol !== dstCol) {
      requestTotp((token) => { void doMove(draggableId, dstCol, token); });
    }
  }

  function onTaskUpdated(updated: Task): void {
    setTasks((prev) => {
      const next = { ...prev };
      // Remove from all columns first
      for (const col of Object.keys(next) as TaskStatus[]) {
        next[col] = next[col].filter((t) => t.id !== updated.id);
      }
      next[updated.status] = [updated, ...next[updated.status]];
      return next;
    });
  }

  function onTaskDeleted(id: string): void {
    setTasks((prev) => {
      const next = { ...prev };
      for (const col of Object.keys(next) as TaskStatus[]) {
        next[col] = next[col].filter((t) => t.id !== id);
      }
      return next;
    });
    setSelectedId(undefined);
  }

  function onTaskCreated(task: Task): void {
    setTasks((prev) => ({
      ...prev,
      inbox: [task, ...prev.inbox],
    }));
    setShowNewForm(false);
    setSelectedId(task.id);
  }

  const columns = showArchiveColumn
    ? [...VISIBLE_COLUMNS, 'archived' as TaskStatus]
    : VISIBLE_COLUMNS;

  if (loading && Object.values(tasks).every((c) => c.length === 0)) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>Loading tasks…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => setShowNewForm(true)}
          className="text-[10px] uppercase tracking-[0.08em]"
          style={{
            padding: '5px 12px',
            background: 'var(--ae-amber)',
            border: 'none',
            color: 'var(--ae-void)',
          }}
        >
          + New Task
        </button>
        <button
          onClick={() => setShowArchiveColumn((v) => !v)}
          className="text-[10px] uppercase tracking-[0.08em]"
          style={{
            padding: '5px 12px',
            background: 'transparent',
            border: '1px solid var(--ae-border-hi)',
            color: showArchiveColumn ? 'var(--ae-text)' : 'var(--ae-text2)',
          }}
        >
          {showArchiveColumn ? 'Hide Archived' : 'Show Archived'}
        </button>
        {error && <p className="text-[11px]" style={{ color: 'var(--ae-red)' }}>{error}</p>}
      </div>

      {/* Board + detail panel */}
      <div className="flex flex-1 min-h-0 gap-0">
        {/* Kanban columns */}
        <div className="flex-1 overflow-x-auto">
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-3 h-full pb-2" style={{ minWidth: columns.length * 200 }}>
              {columns.map((col) => {
                const colTasks = tasks[col];
                return (
                  <div key={col} className="flex flex-col w-48 flex-shrink-0">
                    {/* Column header — amber dash-label pattern */}
                    <div className="flex items-center justify-between mb-2 px-1">
                      <span
                        className="ae-section-label"
                        style={col === 'needs_clarification' ? { color: 'var(--ae-warn)' } : undefined}
                      >── {COLUMN_LABELS[col]} ───</span>
                      <span
                        className="text-[10px] px-1.5 py-0.5"
                        style={{
                          background: 'var(--ae-surface)',
                          border: '1px solid var(--ae-border)',
                          color: 'var(--ae-text3)',
                        }}
                      >
                        {colTasks.length}
                      </span>
                    </div>

                    {/* Droppable area */}
                    <Droppable droppableId={col}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className="flex-1 p-2 space-y-2 overflow-y-auto"
                          style={{
                            minHeight: 120,
                            background: snapshot.isDraggingOver ? 'var(--ae-amber-faint)' : 'var(--ae-void)',
                            border: snapshot.isDraggingOver
                              ? '1px solid var(--ae-amber-dim)'
                              : '1px solid var(--ae-border)',
                          }}
                        >
                          {colTasks.length === 0 && !snapshot.isDraggingOver && (
                            <p className="text-[10px] text-center italic py-4" style={{ color: 'var(--ae-text3)' }}>
                              empty
                            </p>
                          )}
                          {colTasks.map((task, index) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              index={index}
                              isSelected={selectedId === task.id}
                              onClick={() => setSelectedId(selectedId === task.id ? undefined : task.id)}
                            />
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}
            </div>
          </DragDropContext>
        </div>

        {/* Detail panel */}
        {selectedId && (
          <TaskDetailPanel
            key={selectedId}
            taskId={selectedId}
            onClose={() => setSelectedId(undefined)}
            onUpdated={onTaskUpdated}
            onDeleted={onTaskDeleted}
            onRequestTotp={requestTotp}
          />
        )}
      </div>

      {/* Task-Specs inbox */}
      <div className="flex-shrink-0">
        <TaskSpecsInbox
          onImported={onTaskCreated}
          onRequestTotp={requestTotp}
        />
      </div>

      {/* New task form */}
      {showNewForm && (
        <NewTaskForm
          onCreated={onTaskCreated}
          onCancel={() => setShowNewForm(false)}
          onRequestTotp={requestTotp}
        />
      )}

      {/* TOTP dialog */}
      {totpOpen && (
        <TotpDialog
          title="Confirm Action"
          description="Enter your TOTP code to continue."
          onConfirm={onTotpConfirm}
          onCancel={onTotpCancel}
        />
      )}
    </div>
  );
}
