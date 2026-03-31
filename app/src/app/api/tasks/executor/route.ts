// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { isAgentRequest } from '@/lib/auth';
import { getDb, writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';
import { rowToTask, type TaskRow } from '@/lib/task-mappers';
import { scoreTask } from '@/lib/task-scoring';
import { getAllSettings } from '@/lib/settings';

/**
 * Parses and validates a 24h time string to zero-padded "HH:MM".
 * Returns null for invalid input (e.g. "99:99", "ab:cd", minutes > 59).
 */
function parseTime(t: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!match) return null;
  const h = parseInt(match[1]!, 10);
  const m = parseInt(match[2]!, 10);
  // Allow 24:00 as an end-of-day sentinel; reject anything else out of range.
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Returns true if the current wall-clock time in the configured IANA timezone
 * falls within [AGENT_ACTIVE_START, AGENT_ACTIVE_END). Handles overnight windows
 * (e.g. "22:00"–"06:00").  Defaults to always-active when settings are absent.
 * Invalid time values fall back to safe defaults (00:00 / 24:00).
 * Invalid IANA timezone falls back to UTC while still enforcing the window.
 */
function isWithinActiveHours(settings: Record<string, string>): boolean {
  const rawStart = settings['AGENT_ACTIVE_START'];
  const rawEnd   = settings['AGENT_ACTIVE_END'];

  // If neither bound is configured, the executor runs at any hour.
  if (!rawStart && !rawEnd) return true;

  const start = (rawStart ? parseTime(rawStart) : null) ?? '00:00';
  const end   = (rawEnd   ? parseTime(rawEnd)   : null) ?? '24:00';
  const tz    = settings['AGENT_TIMEZONE'] ?? 'UTC';

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
  } catch {
    // Invalid IANA timezone — fall back to UTC while still enforcing the window
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
  }

  const h   = parts.find((p) => p.type === 'hour')?.value   ?? '00';
  const m   = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const now = `${h}:${m}`;

  // String comparison is correct for zero-padded HH:MM in 24 h format
  if (start <= end) return now >= start && now < end;
  // Overnight window e.g. 22:00–06:00
  return now >= start || now < end;
}

/**
 * POST /api/tasks/executor/run
 *
 * Called by the OpenClaw task-executor cron at the start of each run.
 * Agent API key required — no session fallback.
 *
 * Enforces the active-hours gate, then atomically claims the highest-scored
 * inbox task and returns it to the caller.  On a claim race, automatically
 * retries against the next-best candidate so a single lost race does not idle
 * the executor for a full cron interval.
 *
 * Response shapes:
 *   { skip: true,  reason: 'outside_active_hours' | 'no_tasks' }
 *   { skip: false, task: Task }
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAgentRequest(request)) return errorResponse('Unauthorized', 401);

  const ip        = request.headers.get('x-forwarded-for') ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';

  // ── Active-hours gate ────────────────────────────────────────────────────
  const settings = getAllSettings();
  if (!isWithinActiveHours(settings)) {
    return successResponse({ skip: true, reason: 'outside_active_hours' });
  }

  const db = getDb();

  // ── Fetch candidates (bounded, priority-ordered) ─────────────────────────
  const rows = db
    .prepare(
      // Use a larger bounded candidate set so scoreTask() can surface due-soon items.
      'SELECT * FROM tasks WHERE status = ? ORDER BY priority ASC, due_date ASC NULLS LAST LIMIT 500',
    )
    .all('inbox') as TaskRow[];

  if (rows.length === 0) {
    return successResponse({ skip: true, reason: 'no_tasks' });
  }

  // ── Score all candidates, sort descending ────────────────────────────────
  const now = new Date();
  const scored = rows
    .map((row) => ({ row, score: scoreTask(rowToTask(row), now) }))
    .sort((a, b) => b.score - a.score);

  // ── Attempt to claim each candidate in score order ────────────────────────
  // If a peer claims the top candidate between SELECT and UPDATE, try the next
  // best rather than skipping the entire cron interval.
  const sessionId = crypto.randomUUID();
  const claimedAt = new Date().toISOString();

  const claimTaskTx = db.transaction(
    (taskId: string, sid: string, ts: string): { claimed: boolean; claimedRow: TaskRow | undefined } => {
      const result = db
        .prepare(
          `UPDATE tasks
              SET status = 'assigned', execution_session_id = ?, updated_at = ?
            WHERE id = ? AND status = 'inbox'`,
        )
        .run(sid, ts, taskId);

      if (result.changes === 0) {
        return { claimed: false, claimedRow: undefined };
      }

      // ── Record status transition ─────────────────────────────────────────
      db.prepare(
        `INSERT INTO task_status_changes (task_id, from_status, to_status, changed_at)
         VALUES (?, 'inbox', 'assigned', ?)`,
      ).run(taskId, ts);

      writeAuditLog({
        action: 'task.executor.claim',
        resource: `task:${taskId}`,
        result: 'success',
        ip,
        userAgent,
      });

      // Re-fetch to return the fully updated row
      const claimedRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
      return { claimed: true, claimedRow };
    },
  );

  for (const { row } of scored) {
    const txResult = claimTaskTx(row.id, sessionId, claimedAt);
    if (txResult.claimed) {
      if (!txResult.claimedRow) {
        // Extremely unlikely: task deleted between UPDATE and SELECT
        return successResponse({ skip: true, reason: 'no_tasks' });
      }
      return successResponse({ skip: false, task: rowToTask(txResult.claimedRow) });
    }
    // claimed_by_peer — continue to next candidate
  }

  // All candidates were claimed by peers between the SELECT and UPDATE
  return successResponse({ skip: true, reason: 'no_tasks' });
}
