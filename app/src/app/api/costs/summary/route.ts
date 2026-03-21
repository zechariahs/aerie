// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession } from '@/lib/auth';
import { getCostSummary } from '@/lib/cost';
import { errorResponse, successResponse } from '@/lib/api-response';

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const summary = await getCostSummary();
  return successResponse(summary);
}
