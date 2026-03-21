// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, validateTotpFromRequest } from '@/lib/auth';
import { getDb, writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { Task, TaskPriority, TaskStatus, TaskTag, TaskStatusChange, TaskComment } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  tag: string | null;
  assigned_agent: string | null;
  due_date: string | null;
  linked_output: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    tag: (row.tag as TaskTag) ?? undefined,
    assigned_agent: row.assigned_agent ?? undefined,
    due_date: row.due_date ?? undefined,
    linked_output: row.linked_output ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * GET /api/tasks/[id]
 * Returns a single task with its status history and comments.
 */
export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { id } = await params;

  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  if (!row) return errorResponse('Task not found', 404);

  const history = db
    .prepare(
      `SELECT id, task_id, from_status, to_status, changed_at
       FROM task_status_changes WHERE task_id = ? ORDER BY changed_at ASC`,
    )
    .all(id) as Array<{
    id: number;
    task_id: string;
    from_status: string | null;
    to_status: string;
    changed_at: string;
  }>;

  const comments = db
    .prepare(
      `SELECT id, task_id, body, created_at FROM task_comments
       WHERE task_id = ? ORDER BY created_at ASC`,
    )
    .all(id) as Array<{ id: number; task_id: string; body: string; created_at: string }>;

  return successResponse({
    task: rowToTask(row),
    history: history.map(
      (h): TaskStatusChange => ({
        id: h.id,
        task_id: h.task_id,
        from_status: (h.from_status as TaskStatus) ?? undefined,
        to_status: h.to_status as TaskStatus,
        changed_at: h.changed_at,
      }),
    ),
    comments: comments.map(
      (c): TaskComment => ({
        id: c.id,
        task_id: c.task_id,
        body: c.body,
        created_at: c.created_at,
      }),
    ),
  });
}

const VALID_STATUSES: TaskStatus[] = ['inbox', 'assigned', 'in_progress', 'review', 'done', 'archived'];
const VALID_PRIORITIES: TaskPriority[] = ['P1', 'P2', 'P3', 'P4'];

interface UpdateTaskBody {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  tag?: TaskTag | null;
  assigned_agent?: string | null;
  due_date?: string | null;
  linked_output?: string | null;
  comment?: string;
}

/**
 * PUT /api/tasks/[id]
 * Updates any mutable fields on a task (including column move).
 * Requires session + valid X-TOTP-Token header.
 */
export async function PUT(request: Request, { params }: RouteContext): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (!validateTotpFromRequest(request)) {
    writeAuditLog({
      action: 'task.update',
      resource: 'task',
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse('TOTP required', 403);
  }

  const { id } = await params;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  if (!existing) return errorResponse('Task not found', 404);

  let body: UpdateTaskBody;
  try {
    body = (await request.json()) as UpdateTaskBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return errorResponse('Invalid status value', 400);
  }
  if (body.priority !== undefined && !VALID_PRIORITIES.includes(body.priority)) {
    return errorResponse('Invalid priority value', 400);
  }

  const now = new Date().toISOString();
  const prevStatus = existing.status as TaskStatus;
  const newStatus = body.status ?? prevStatus;

  db.prepare(
    `UPDATE tasks SET
      title = COALESCE(?, title),
      description = CASE WHEN ? IS NOT NULL THEN ? ELSE description END,
      status = COALESCE(?, status),
      priority = COALESCE(?, priority),
      tag = CASE WHEN ? IS NOT NULL THEN ? ELSE tag END,
      assigned_agent = CASE WHEN ? IS NOT NULL THEN ? ELSE assigned_agent END,
      due_date = CASE WHEN ? IS NOT NULL THEN ? ELSE due_date END,
      linked_output = CASE WHEN ? IS NOT NULL THEN ? ELSE linked_output END,
      updated_at = ?
     WHERE id = ?`,
  ).run(
    body.title?.trim() ?? null,
    body.description !== undefined ? '1' : null,
    body.description ?? null,
    body.status ?? null,
    body.priority ?? null,
    body.tag !== undefined ? '1' : null,
    body.tag ?? null,
    body.assigned_agent !== undefined ? '1' : null,
    body.assigned_agent ?? null,
    body.due_date !== undefined ? '1' : null,
    body.due_date ?? null,
    body.linked_output !== undefined ? '1' : null,
    body.linked_output ?? null,
    now,
    id,
  );

  // Record status change when column moves
  if (body.status && body.status !== prevStatus) {
    db.prepare(
      `INSERT INTO task_status_changes (task_id, from_status, to_status, changed_at)
       VALUES (?, ?, ?, ?)`,
    ).run(id, prevStatus, newStatus, now);
  }

  // Append comment if provided
  if (body.comment && typeof body.comment === 'string' && body.comment.trim() !== '') {
    db.prepare(
      `INSERT INTO task_comments (task_id, body, created_at) VALUES (?, ?, ?)`,
    ).run(id, body.comment.trim(), now);
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';
  writeAuditLog({ action: 'task.update', resource: `task:${id}`, result: 'success', ip, userAgent });

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
  return successResponse(rowToTask(updated));
}

/**
 * DELETE /api/tasks/[id]
 * Permanently deletes a task and its related records.
 * Requires session + valid X-TOTP-Token header.
 */
export async function DELETE(request: Request, { params }: RouteContext): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (!validateTotpFromRequest(request)) {
    writeAuditLog({
      action: 'task.delete',
      resource: 'task',
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse('TOTP required', 403);
  }

  const { id } = await params;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!existing) return errorResponse('Task not found', 404);

  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';
  writeAuditLog({ action: 'task.delete', resource: `task:${id}`, result: 'success', ip, userAgent });

  return successResponse({ deleted: true });
}
