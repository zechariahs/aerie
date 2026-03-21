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

type TasksByColumn = Record<TaskStatus, Task[]>;

const COLUMN_LABELS: Record<TaskStatus, string> = {
  inbox: 'Inbox',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  archived: 'Archived',
};

const VISIBLE_COLUMNS: TaskStatus[] = ['inbox', 'assigned', 'in_progress', 'review', 'done'];

/**
 * Full Kanban board with drag-and-drop, task detail panel, and new-task form.
 * TOTP is collected once per write action via the TotpDialog.
 */
export function KanbanBoard(): React.JSX.Element {
  const [tasks, setTasks] = useState<TasksByColumn>({
    inbox: [], assigned: [], in_progress: [], review: [], done: [], archived: [],
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
  const pendingActionRef = useRef<(() => void) | undefined>(undefined);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/tasks?showArchived=${showArchived ? '1' : '0'}`);
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

  /** Opens the TOTP dialog. The action runs after the user submits a valid token. */
  function requestTotp(action: () => void): void {
    pendingActionRef.current = action;
    setTotpOpen(true);
  }

  function onTotpConfirm(token: string): void {
    setTotpToken(token);
    setTotpOpen(false);
    if (pendingActionRef.current) {
      pendingActionRef.current();
      pendingActionRef.current = undefined;
    }
  }

  function onTotpCancel(): void {
    setTotpOpen(false);
    pendingActionRef.current = undefined;
  }

  async function doMove(taskId: string, newStatus: TaskStatus, token: string): Promise<void> {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-TOTP-Token': token },
      body: JSON.stringify({ status: newStatus }),
    });

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
      requestTotp(() => { void doMove(draggableId, dstCol, totpToken); });
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
        <p className="text-sm text-[#6b7280]">Loading tasks…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => setShowNewForm(true)}
          className="px-3 py-1.5 text-xs text-white bg-[#3b82f6] rounded hover:bg-[#2563eb] transition-colors"
        >
          + New Task
        </button>
        <button
          onClick={() => setShowArchiveColumn((v) => !v)}
          className={`px-3 py-1.5 text-xs rounded border transition-colors ${
            showArchiveColumn
              ? 'text-white border-[#374151] bg-[#1e1e2e]'
              : 'text-[#6b7280] border-[#1e1e2e] hover:text-white'
          }`}
        >
          {showArchiveColumn ? 'Hide Archived' : 'Show Archived'}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
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
                    {/* Column header */}
                    <div className="flex items-center justify-between mb-2 px-1">
                      <span className="text-xs font-semibold text-[#6b7280] uppercase tracking-widest">
                        {COLUMN_LABELS[col]}
                      </span>
                      <span className="text-[10px] text-[#374151] bg-[#12121a] px-1.5 py-0.5 rounded">
                        {colTasks.length}
                      </span>
                    </div>

                    {/* Droppable area */}
                    <Droppable droppableId={col}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={[
                            'flex-1 rounded-lg p-2 space-y-2 transition-colors overflow-y-auto',
                            snapshot.isDraggingOver
                              ? 'bg-[#1a1f3a] border border-[#3b82f6]/30'
                              : 'bg-[#0a0a11] border border-[#1e1e2e]',
                          ].join(' ')}
                          style={{ minHeight: 120 }}
                        >
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
            totpToken={totpToken}
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
          totpToken={totpToken}
          onImported={onTaskCreated}
          onRequestTotp={requestTotp}
        />
      </div>

      {/* New task form */}
      {showNewForm && (
        <NewTaskForm
          totpToken={totpToken}
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
