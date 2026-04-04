// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { requireTotpAuth } from '@/lib/auth';
import { setCronEnabled, updateCronSchedule, updateCronPrompt } from '@/lib/gateway';
import { getRawCronPayload } from '@/lib/openclaw';
import { writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface CronUpdateBody {
  enabled?: boolean;
  schedule?: string;
  scheduleTz?: string;
  prompt?: string;
}

/**
 * PUT /api/crons/[id]
 * Updates the enabled state, schedule, or prompt for a cron job via the Gateway.
 * Requires session cookie + valid X-TOTP-Token header.
 * Accepts: { enabled?: boolean, schedule?: string, scheduleTz?: string, prompt?: string }
 */
export async function PUT(request: Request, { params }: RouteContext): Promise<Response> {
  const auth = await requireTotpAuth(request);
  if (!auth.ok) {
    if (auth.status === 403) {
      writeAuditLog({ action: 'cron.update', resource: 'cron', result: 'failure', ip: request.headers.get('x-forwarded-for') ?? 'unknown', userAgent: request.headers.get('user-agent') ?? 'unknown' });
    }
    return errorResponse(auth.status === 401 ? 'Unauthorized' : 'TOTP required', auth.status);
  }

  const { id } = await params;

  let body: CronUpdateBody;
  try {
    body = (await request.json()) as CronUpdateBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { enabled, schedule, scheduleTz, prompt } = body;

  if (enabled === undefined && schedule === undefined && prompt === undefined) {
    return errorResponse('Provide at least one of: enabled, schedule, prompt', 400);
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
    const tz = typeof scheduleTz === 'string' && scheduleTz.trim() ? scheduleTz.trim() : 'America/Chicago';
    const result = await updateCronSchedule(id, schedule.trim(), tz);
    writeAuditLog({ action: 'cron.setSchedule', resource: `cron:${id}`, result: result.ok ? 'success' : 'failure', ip, userAgent });
    if (!result.ok) return errorResponse(result.error ?? 'Update failed', 503);
  }

  if (prompt !== undefined) {
    if (typeof prompt !== 'string') {
      return errorResponse('prompt must be a string', 400);
    }
    const currentPayload = getRawCronPayload(id);
    const result = await updateCronPrompt(id, prompt.trim(), currentPayload);
    writeAuditLog({ action: `cron.setPrompt:len=${prompt.trim().length}`, resource: `cron:${id}`, result: result.ok ? 'success' : 'failure', ip, userAgent });
    if (!result.ok) return errorResponse(result.error ?? 'Update failed', 503);
  }

  return successResponse({ updated: true });
}
