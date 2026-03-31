// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, validateTotpFromRequest } from '@/lib/auth';
import { getDb, writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';
import { triggerCron } from '@/lib/gateway';
import { rowToTask, type TaskRow } from '@/lib/task-mappers';
import type { Task } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function formatTaskMessage(task: Task): string {
  const lines: string[] = [
    `📋 *Task: ${task.title}*`,
    `Priority: ${task.priority} | Status: ${task.status.replace('_', ' ')}`,
  ];

  if (task.tag) lines.push(`Tag: ${task.tag}`);
  if (task.assigned_agent) lines.push(`Agent: ${task.assigned_agent}`);
  if (task.description) lines.push(`\n${task.description}`);
  if (task.due_date) lines.push(`\nDue: ${task.due_date}`);

  return lines.join('\n');
}

/**
 * POST /api/tasks/[id]/send-telegram
 * Sends the task as a structured Telegram message via the Gateway RPC.
 * Delivery target is the TELEGRAM_DELIVERY_UID env var.
 * Requires session + valid X-TOTP-Token header.
 *
 * REQUIRES_GATEWAY — returns 503 if Gateway is unavailable.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (!validateTotpFromRequest(request)) {
    writeAuditLog({
      action: 'task.sendTelegram',
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

  const task = rowToTask(row);

  const deliveryUid = process.env['TELEGRAM_DELIVERY_UID'];
  if (!deliveryUid) {
    return errorResponse('TELEGRAM_DELIVERY_UID not configured', 503);
  }

  const message = formatTaskMessage(task);

  // Reuse the gateway RPC path. The message delivery RPC sends a Telegram
  // message to TELEGRAM_DELIVERY_UID via the OpenClaw Gateway.
  // REQUIRES_GATEWAY — returns error if Gateway is unavailable.
  const result = await triggerCron(`telegram:${deliveryUid}:${encodeURIComponent(message)}`);

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';

  if (!result.ok) {
    writeAuditLog({ action: 'task.sendTelegram', resource: `task:${id}`, result: 'failure', ip, userAgent });
    return errorResponse(result.error ?? 'Telegram delivery failed', 503);
  }

  writeAuditLog({ action: 'task.sendTelegram', resource: `task:${id}`, result: 'success', ip, userAgent });
  return successResponse({ sent: true });
}
