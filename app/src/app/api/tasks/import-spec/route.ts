// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, validateTotpFromRequest } from '@/lib/auth';
import { getDb, writeAuditLog } from '@/lib/db';
import { readDoc } from '@/lib/drive';
import { errorResponse, successResponse } from '@/lib/api-response';
import { rowToTask, type TaskRow } from '@/lib/task-mappers';

interface ImportSpecBody {
  fileId: string;
  title: string;
  driveUrl: string;
}

/**
 * POST /api/tasks/import-spec
 * Imports a Google Doc from Task-Specs/ folder as a new Inbox task.
 * Reads the doc content and stores it as the task description.
 * Requires session + valid X-TOTP-Token header.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (!validateTotpFromRequest(request)) {
    writeAuditLog({
      action: 'task.importSpec',
      resource: 'task',
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse('TOTP required', 403);
  }

  let body: ImportSpecBody;
  try {
    body = (await request.json()) as ImportSpecBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.fileId || typeof body.fileId !== 'string') {
    return errorResponse('fileId is required', 400);
  }
  if (!body.title || typeof body.title !== 'string') {
    return errorResponse('title is required', 400);
  }

  // Read doc content from Drive (best-effort — create task even if read fails)
  let description: string | undefined;
  const readResult = await readDoc(body.fileId);
  if (readResult.ok) {
    description = readResult.content.trim().slice(0, 4000);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const db = getDb();
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, tag, assigned_agent, due_date, linked_output, source, capability_tier, clarification_state, created_at, updated_at)
     VALUES (?, ?, ?, 'inbox', 'P3', NULL, NULL, NULL, ?, 'manual', 'default', 'none', ?, ?)`,
  ).run(id, body.title.trim(), description ?? null, body.driveUrl ?? null, now, now);

  db.prepare(
    `INSERT INTO task_status_changes (task_id, from_status, to_status, changed_at)
     VALUES (?, NULL, 'inbox', ?)`,
  ).run(id, now);

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';
  writeAuditLog({ action: 'task.importSpec', resource: `task:${id}`, result: 'success', ip, userAgent });

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
  return successResponse(rowToTask(row), 201);
}
