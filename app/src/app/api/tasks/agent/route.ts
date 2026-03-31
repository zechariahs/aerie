// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { isAgentRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';
import type {
  Task,
  TaskCapabilityTier,
  TaskClarificationState,
  TaskPriority,
  TaskSource,
  TaskStatus,
  TaskTag,
} from '@/types';

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  tag: string | null;
  assigned_agent: string | null;
  due_date: string | null;
  linked_output: string | null;
  created_at: string;
  updated_at: string;
  source: string;
  capability_tier: string;
  clarification_questions: string | null;
  clarification_responses: string | null;
  clarification_state: string;
  execution_session_id: string | null;
  output_summary: string | null;
  output_artifact_url: string | null;
}

interface ModelTierRow {
  tier: string;
  model_id: string;
}

interface AgentTask extends Task {
  resolved_model: string | undefined;
  score?: number;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    tag: (row.tag as TaskTag) ?? undefined,
    assigned_agent: row.assigned_agent ?? undefined,
    due_date: row.due_date ?? undefined,
    linked_output: row.linked_output ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    source: (row.source as TaskSource) ?? 'manual',
    capability_tier: (row.capability_tier as TaskCapabilityTier) ?? 'default',
    clarification_questions: row.clarification_questions
      ? (JSON.parse(row.clarification_questions) as string[])
      : undefined,
    clarification_responses: row.clarification_responses
      ? (JSON.parse(row.clarification_responses) as string[])
      : undefined,
    clarification_state: (row.clarification_state as TaskClarificationState) ?? 'none',
    execution_session_id: row.execution_session_id ?? undefined,
    output_summary: row.output_summary ?? undefined,
    output_artifact_url: row.output_artifact_url ?? undefined,
  };
}

/**
 * Scores a task based on priority and due-date proximity.
 * Higher score = higher priority for executor.
 *
 * +50  if P1, +30 if P2, +10 if P3, +0 if P4
 * +100 if overdue (due_date < now)
 * +40  if due within 4h (and not overdue)
 * +20  if due within 24h (and not within 4h)
 */
function scoreTask(task: Task, now: Date): number {
  let score = 0;

  if (task.priority === 'P1') score += 50;
  else if (task.priority === 'P2') score += 30;
  else if (task.priority === 'P3') score += 10;

  if (task.due_date) {
    const dueMs = new Date(task.due_date).getTime();
    const nowMs = now.getTime();
    if (dueMs < nowMs) {
      score += 100;
    } else {
      const diffMs = dueMs - nowMs;
      if (diffMs <= 4 * 3600 * 1000) score += 40;
      else if (diffMs <= 24 * 3600 * 1000) score += 20;
    }
  }

  return score;
}

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
  const status = (url.searchParams.get('status') ?? 'inbox') as TaskStatus;
  const limitParam = parseInt(url.searchParams.get('limit') ?? '10', 10);
  const limit = isNaN(limitParam) ? 10 : Math.min(Math.max(1, limitParam), 100);
  const includeScore = url.searchParams.get('scored') === '1';

  const db = getDb();

  const rows = db
    .prepare('SELECT * FROM tasks WHERE status = ? ORDER BY priority ASC, created_at ASC')
    .all(status) as TaskRow[];

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
