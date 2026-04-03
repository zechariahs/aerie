// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { requireTotpAuth } from '@/lib/auth';
import { triggerCron } from '@/lib/gateway';
import { writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/crons/[id]/trigger
 * Sends a trigger request to the Gateway to run a cron job immediately.
 * Requires session cookie + valid X-TOTP-Token header.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const auth = await requireTotpAuth(request);
  if (!auth.ok) {
    if (auth.status === 403) {
      writeAuditLog({ action: 'cron.trigger', resource: 'cron', result: 'failure', ip: request.headers.get('x-forwarded-for') ?? 'unknown', userAgent: request.headers.get('user-agent') ?? 'unknown' });
    }
    return errorResponse(auth.status === 401 ? 'Unauthorized' : 'TOTP required', auth.status);
  }

  const { id } = await params;

  const result = await triggerCron(id);

  writeAuditLog({
    action: 'cron.trigger',
    resource: `cron:${id}`,
    result: result.ok ? 'success' : 'failure',
    ip: request.headers.get('x-forwarded-for') ?? 'unknown',
    userAgent: request.headers.get('user-agent') ?? 'unknown',
  });

  if (!result.ok) {
    return errorResponse(result.error ?? 'Trigger failed', 503);
  }

  return successResponse({ triggered: true });
}
