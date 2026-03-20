// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession } from '@/lib/auth';
import { getPaginatedSessions } from '@/lib/cost';
import { errorResponse, successResponse } from '@/lib/api-response';

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId') ?? undefined;
  const daysParam = searchParams.get('days') ?? '30';
  const pageParam = searchParams.get('page') ?? '1';
  const limitParam = searchParams.get('limit') ?? '50';

  const days = parseInt(daysParam, 10);
  const page = parseInt(pageParam, 10);
  const limit = parseInt(limitParam, 10);

  if (isNaN(days) || days < 1 || days > 365) {
    return errorResponse('days must be an integer between 1 and 365', 400);
  }
  if (isNaN(page) || page < 1) {
    return errorResponse('page must be a positive integer', 400);
  }
  if (isNaN(limit) || limit < 1 || limit > 200) {
    return errorResponse('limit must be an integer between 1 and 200', 400);
  }

  const result = await getPaginatedSessions({ agentId, days, page, limit });
  return successResponse(result);
}
