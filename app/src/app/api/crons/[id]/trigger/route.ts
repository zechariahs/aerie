// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, validateTotpFromRequest } from '@/lib/auth';
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
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (!validateTotpFromRequest(request)) {
    writeAuditLog({
      action: 'cron.trigger',
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
