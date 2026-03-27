// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession } from '@/lib/auth';
import { getCronRunSummaryRows, computeCost, loadPriceTable } from '@/lib/cost';
import { getCronJobs, readOpenClawConfig } from '@/lib/openclaw';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { CronCostSummaryRow } from '@/types';

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const daysParam = searchParams.get('days') ?? '30';
  const days = parseInt(daysParam, 10);

  if (isNaN(days) || days < 1 || days > 365) {
    return errorResponse('days must be an integer between 1 and 365', 400);
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  const summaryRows = getCronRunSummaryRows(monthStart);
  const priceTable = loadPriceTable();
  const { providerModels } = readOpenClawConfig();

  // Build cron name lookup from jobs
  const jobs = getCronJobs();
  const cronNameMap = new Map(jobs.map((j) => [j.id, j.name]));
  // Also build model lookup per cron from the summary data for computeCost
  // We need the model per cron — query it separately
  const { getDb } = await import('@/lib/db');
  type ModelRow = { cron_id: string; model: string | null };
  const modelRows = getDb()
    .prepare<[string], ModelRow>(
      `SELECT cron_id, model
       FROM cron_runs
       WHERE started_at >= ? AND input_tokens IS NOT NULL
       GROUP BY cron_id
       ORDER BY MAX(started_at) DESC`,
    )
    .all(monthStart) as ModelRow[];
  const cronModelMap = new Map(modelRows.map((r) => [r.cron_id, r.model ?? 'unknown']));

  const rows: CronCostSummaryRow[] = summaryRows.map((row) => {
    const modelId = cronModelMap.get(row.cronId) ?? 'unknown';
    // Compute cost using totals (avgTokensPerRun * runCount ≈ totalInput + totalOutput)
    const totalThisMonth = computeCost(
      row.totalInput,
      row.totalOutput,
      modelId,
      priceTable,
      { totalTokens: row.totalAllTokens || undefined, providerModels },
    );
    const avgCostPerRun = row.runCount > 0 ? totalThisMonth / row.runCount : 0;

    return {
      cronId: row.cronId,
      cronName: cronNameMap.get(row.cronId) ?? row.cronId,
      avgTokensPerRun: row.avgTokensPerRun,
      avgCostPerRun,
      totalThisMonth,
      runCount: row.runCount,
    };
  });

  // Sort by total cost descending
  rows.sort((a, b) => b.totalThisMonth - a.totalThisMonth);

  return successResponse(rows);
}
