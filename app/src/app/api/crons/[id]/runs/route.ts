// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession } from '@/lib/auth';
import { readCronRuns } from '@/lib/openclaw';
import { errorResponse, successResponse } from '@/lib/api-response';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/crons/[id]/runs?limit=20
 * Returns run history for a specific cron job from mc.db.
 * Requires session cookie (read-only — no TOTP needed).
 */
export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { id } = await params;

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit') ?? '20';
  const limit = parseInt(limitParam, 10);

  if (isNaN(limit) || limit < 1 || limit > 100) {
    return errorResponse('limit must be an integer between 1 and 100', 400);
  }

  const runs = readCronRuns(id, limit);
  return successResponse(runs);
}
