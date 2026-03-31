// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { isAgentRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';
import { rowToTask, type TaskRow } from '@/lib/task-mappers';
import { scoreTask } from '@/lib/task-scoring';
import type { Task, TaskStatus } from '@/types';

interface ModelTierRow {
  tier: string;
  model_id: string;
}

interface AgentTask extends Task {
  resolved_model: string | undefined;
  score?: number;
}

const VALID_AGENT_STATUSES: TaskStatus[] = [
  'inbox', 'assigned', 'in_progress', 'needs_clarification', 'review',
];

/**
 * GET /api/tasks/agent
 * Returns a scored, workable task list for the executor cron.
 * Agent API key required — no session fallback.
 *
 * Query params:
 *   status  — TaskStatus to filter by (default: 'inbox')
 *   limit   — max results (default: 10, max: 100)
 *   scored  — '1' to include computed score field
 */
export async function GET(request: Request): Promise<Response> {
  if (!isAgentRequest(request)) return errorResponse('Unauthorized', 401);

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get('status') ?? 'inbox';
  if (!VALID_AGENT_STATUSES.includes(rawStatus as TaskStatus)) {
    return errorResponse('Invalid status parameter', 400);
  }
  const status = rawStatus as TaskStatus;
  const limitParam = parseInt(url.searchParams.get('limit') ?? '10', 10);
  const limit = isNaN(limitParam) ? 10 : Math.min(Math.max(1, limitParam), 100);
  const includeScore = url.searchParams.get('scored') === '1';

  const db = getDb();

  // Pre-cap candidates at limit*5 (max 500) using a priority heuristic so
  // the JS scoring/sort operates on a bounded set. This is a best-effort
  // optimisation — the scoring algo can in theory promote a lower-priority
  // task above a higher-priority one (via due-date bonuses), so we fetch a
  // generous multiple to preserve correctness in the common case.
  const candidateCap = Math.min(limit * 5, 500);
  const rows = db
    .prepare('SELECT * FROM tasks WHERE status = ? ORDER BY priority ASC, due_date ASC NULLS LAST LIMIT ?')
    .all(status, candidateCap) as TaskRow[];

  // Load model tiers once for resolved_model lookup on each task
  const tierRows = db.prepare('SELECT tier, model_id FROM model_tiers').all() as ModelTierRow[];
  const tierMap = new Map<string, string>(tierRows.map((r) => [r.tier, r.model_id]));

  const now = new Date();

  // Score all tasks, then sort descending, then apply limit
  const scored = rows.map((row) => {
    const task = rowToTask(row);
    return { task, score: scoreTask(task, now) };
  });
  scored.sort((a, b) => b.score - a.score);

  const result: AgentTask[] = scored.slice(0, limit).map(({ task, score }) => {
    // 'auto' tier is resolved by the executor at runtime (§5) — no model returned here
    const resolved_model =
      task.capability_tier === 'auto'
        ? undefined
        : (tierMap.get(task.capability_tier) ?? undefined);
    const agentTask: AgentTask = { ...task, resolved_model };
    if (includeScore) agentTask.score = score;
    return agentTask;
  });

  return successResponse(result);
}
