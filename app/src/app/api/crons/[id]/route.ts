// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, validateTotpFromRequest } from '@/lib/auth';
import { setCronEnabled, updateCronSchedule } from '@/lib/gateway';
import { writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface CronUpdateBody {
  enabled?: boolean;
  schedule?: string;
}

/**
 * PUT /api/crons/[id]
 * Updates the enabled state or schedule for a cron job via the Gateway.
 * Requires session cookie + valid X-TOTP-Token header.
 * Accepts: { enabled?: boolean, schedule?: string }
 */
export async function PUT(request: Request, { params }: RouteContext): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (!validateTotpFromRequest(request)) {
    writeAuditLog({
      action: 'cron.update',
      resource: 'cron',
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse('TOTP required', 403);
  }

  const { id } = await params;

  // Validate cron ID format: 8 hex characters
  if (!/^[0-9a-f]{8}$/i.test(id)) {
    return errorResponse('Invalid cron ID', 400);
  }

  let body: CronUpdateBody;
  try {
    body = (await request.json()) as CronUpdateBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { enabled, schedule } = body;

  if (enabled === undefined && schedule === undefined) {
    return errorResponse('Provide at least one of: enabled, schedule', 400);
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';

  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') {
      return errorResponse('enabled must be a boolean', 400);
    }
    const result = await setCronEnabled(id, enabled);
    writeAuditLog({ action: 'cron.setEnabled', resource: `cron:${id}`, result: result.ok ? 'success' : 'failure', ip, userAgent });
    if (!result.ok) return errorResponse(result.error ?? 'Update failed', 503);
  }

  if (schedule !== undefined) {
    // Basic cron expression validation: 5 space-separated fields
    if (typeof schedule !== 'string' || !/^\S+(\s+\S+){4}$/.test(schedule.trim())) {
      return errorResponse('schedule must be a valid 5-field cron expression', 400);
    }
    const result = await updateCronSchedule(id, schedule.trim());
    writeAuditLog({ action: 'cron.setSchedule', resource: `cron:${id}`, result: result.ok ? 'success' : 'failure', ip, userAgent });
    if (!result.ok) return errorResponse(result.error ?? 'Update failed', 503);
  }

  return successResponse({ updated: true });
}
