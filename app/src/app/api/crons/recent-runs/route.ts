// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { CronRun } from '@/types';

/**
 * GET /api/crons/recent-runs?limit=30
 * Returns the most recent cron runs across all jobs, newest-first.
 * Used by the activity feed to pre-populate with historical data on mount.
 * Requires session cookie (read-only — no TOTP needed).
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit') ?? '30';
  const limit = parseInt(limitParam, 10);

  if (isNaN(limit) || limit < 1 || limit > 100) {
    return errorResponse('limit must be an integer between 1 and 100', 400);
  }

  type Row = {
    id: string;
    cron_id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    duration_ms: number | null;
    output_excerpt: string | null;
    drive_url: string | null;
    error_message: string | null;
    run_at_ms: number | null;
    model: string | null;
    provider: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  };

  const rows = getDb()
    .prepare<[number], Row>(
      `SELECT * FROM cron_runs
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(limit);

  const runs: CronRun[] = rows.map((row): CronRun => {
    const rawStatus = row.status;
    const status: CronRun['status'] =
      rawStatus === 'success' || rawStatus === 'running' ? rawStatus : 'failure';

    return {
      id: row.id,
      cronId: row.cron_id,
      status,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      outputExcerpt: row.output_excerpt ?? undefined,
      driveUrl: row.drive_url ?? undefined,
      errorMessage: row.error_message ?? undefined,
      runAtMs: row.run_at_ms ?? undefined,
      model: row.model ?? undefined,
      provider: row.provider ?? undefined,
      usage:
        row.input_tokens != null && row.output_tokens != null
          ? {
              input_tokens: row.input_tokens,
              output_tokens: row.output_tokens,
              total_tokens: row.total_tokens ?? undefined,
            }
          : undefined,
    };
  });

  return successResponse(runs);
}
