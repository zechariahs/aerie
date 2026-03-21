// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession } from '@/lib/auth';
import { getCronJobs } from '@/lib/openclaw';
import { errorResponse, successResponse } from '@/lib/api-response';

/**
 * GET /api/crons
 * Returns all cron jobs from openclaw.json, enriched with latest run status.
 * Requires session cookie (read-only — no TOTP needed).
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const jobs = getCronJobs();
  return successResponse(jobs);
}
