// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, validateTotpFromRequest } from '@/lib/auth';
import { getDb, writeAuditLog } from '@/lib/db';
import { writeGoogleDoc } from '@/lib/drive';
import { errorResponse, successResponse } from '@/lib/api-response';
import type {
  Task,
  TaskCapabilityTier,
  TaskClarificationState,
  TaskPriority,
  TaskSource,
  TaskStatus,
  TaskTag,
} from '@/types';

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
  source: string;
  capability_tier: string;
  clarification_questions: string | null;
  clarification_responses: string | null;
  clarification_state: string;
  execution_session_id: string | null;
  output_summary: string | null;
  output_artifact_url: string | null;
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

  const task: Task = {
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
    source: (row.source as TaskSource) ?? 'manual',
    capability_tier: (row.capability_tier as TaskCapabilityTier) ?? 'default',
    clarification_questions: row.clarification_questions
      ? (JSON.parse(row.clarification_questions) as string[])
      : undefined,
    clarification_responses: row.clarification_responses
      ? (JSON.parse(row.clarification_responses) as string[])
      : undefined,
    clarification_state: (row.clarification_state as TaskClarificationState) ?? 'none',
    execution_session_id: row.execution_session_id ?? undefined,
    output_summary: row.output_summary ?? undefined,
    output_artifact_url: row.output_artifact_url ?? undefined,
  };

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
