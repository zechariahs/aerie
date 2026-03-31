// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, validateTotpFromRequest } from '@/lib/auth';
import { getDb, writeAuditLog } from '@/lib/db';
import { writeGoogleDoc } from '@/lib/drive';
import { errorResponse, successResponse } from '@/lib/api-response';
import { rowToTask, type TaskRow } from '@/lib/task-mappers';
import type { Task } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function buildDocContent(task: Task): string {
  const lines: string[] = [
    `# ${task.title}`,
    '',
    `**Priority:** ${task.priority}`,
    `**Status:** ${task.status.replace('_', ' ')}`,
  ];

  if (task.tag) lines.push(`**Tag:** ${task.tag}`);
  if (task.assigned_agent) lines.push(`**Assigned Agent:** ${task.assigned_agent}`);
  if (task.due_date) lines.push(`**Due Date:** ${task.due_date}`);
  if (task.description) {
    lines.push('', '## Description', '', task.description);
  }

  lines.push('', '---', `*Created: ${task.created_at}*`);
  return lines.join('\n');
}

/**
 * POST /api/tasks/[id]/send-drive
 * Creates a native Google Doc in the Task-Specs/ Drive folder.
 * Drive folder ID comes from GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID env var.
 * Requires session + valid X-TOTP-Token header.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (!validateTotpFromRequest(request)) {
    writeAuditLog({
      action: 'task.sendDrive',
      resource: 'task',
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse('TOTP required', 403);
  }

  const { id } = await params;
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  if (!row) return errorResponse('Task not found', 404);

  const folderId = process.env['GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID'];
  if (!folderId) {
    return errorResponse('GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID not configured', 503);
  }

  const task = rowToTask(row);

  const title = `[Task] ${task.title}`;
  const content = buildDocContent(task);
  const result = await writeGoogleDoc(folderId, title, content);

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';

  if (!result.ok) {
    writeAuditLog({ action: 'task.sendDrive', resource: `task:${id}`, result: 'failure', ip, userAgent });
    return errorResponse(result.error, 503);
  }

  // Store the Drive URL back on the task as linked_output
  db.prepare('UPDATE tasks SET linked_output = ?, updated_at = ? WHERE id = ?').run(
    result.url,
    new Date().toISOString(),
    id,
  );

  writeAuditLog({ action: 'task.sendDrive', resource: `task:${id}`, result: 'success', ip, userAgent });
  return successResponse({ driveUrl: result.url, driveId: result.id });
}
