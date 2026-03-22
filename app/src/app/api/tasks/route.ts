// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, validateTotpFromRequest } from '@/lib/auth';
import { getDb, writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { Task, TaskPriority, TaskStatus, TaskTag } from '@/types';

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
 * GET /api/tasks
 * Returns all tasks grouped by column (excluding archived unless showArchived=1).
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const url = new URL(request.url);
  const showArchived = url.searchParams.get('showArchived') === '1';

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       ${showArchived ? '' : "WHERE status != 'archived'"}
       ORDER BY priority ASC, created_at ASC`,
    )
    .all() as TaskRow[];

  const grouped: Record<TaskStatus, Task[]> = {
    inbox: [],
    assigned: [],
    in_progress: [],
    review: [],
    done: [],
    archived: [],
  };

  for (const row of rows) {
    const task = rowToTask(row);
    grouped[task.status].push(task);
  }

  return successResponse(grouped);
}

interface CreateTaskBody {
  title: string;
  description?: string;
  priority?: TaskPriority;
  tag?: TaskTag;
  assigned_agent?: string;
  due_date?: string;
}

/**
 * POST /api/tasks
 * Creates a new task in the inbox column.
 * Requires session + valid X-TOTP-Token header.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (!validateTotpFromRequest(request)) {
    writeAuditLog({
      action: 'task.create',
      resource: 'task',
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse('TOTP required', 403);
  }

  let body: CreateTaskBody;
  try {
    body = (await request.json()) as CreateTaskBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
    return errorResponse('title is required', 400);
  }

  const validPriorities: TaskPriority[] = ['P1', 'P2', 'P3', 'P4'];
  const priority: TaskPriority = validPriorities.includes(body.priority as TaskPriority)
    ? (body.priority as TaskPriority)
    : 'P3';

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const db = getDb();

  db.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, tag, assigned_agent, due_date, linked_output, created_at, updated_at)
     VALUES (?, ?, ?, 'inbox', ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    body.title.trim(),
    body.description ?? null,
    priority,
    body.tag ?? null,
    body.assigned_agent ?? null,
    body.due_date ?? null,
    now,
    now,
  );

  db.prepare(
    `INSERT INTO task_status_changes (task_id, from_status, to_status, changed_at)
     VALUES (?, NULL, 'inbox', ?)`,
  ).run(id, now);

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';
  writeAuditLog({ action: 'task.create', resource: `task:${id}`, result: 'success', ip, userAgent });

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
  return successResponse(rowToTask(row), 201);
}
