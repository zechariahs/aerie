// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession } from '@/lib/auth';
import { getMergedCosts } from '@/lib/cost';
import { errorResponse, successResponse } from '@/lib/api-response';

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const daysParam = searchParams.get('days') ?? '30';
  const days = parseInt(daysParam, 10);

  if (isNaN(days) || days < 1 || days > 365) {
    return errorResponse('days must be an integer between 1 and 365', 400);
  }

  const costs = await getMergedCosts(days);
  return successResponse(costs);
}
