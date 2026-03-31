// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { isAgentRequest } from '@/lib/auth';
import { getDb, writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';
import { rowToTask, type TaskRow } from '@/lib/task-mappers';
import { scoreTask } from '@/lib/task-scoring';

interface SettingsRow {
  key: string;
  value: string;
}

function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as SettingsRow[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

/** Normalises a time string to zero-padded "HH:MM", e.g. "9:05" → "09:05". */
function normaliseTime(t: string): string {
  const [h = '0', m = '0'] = t.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

/**
 * Returns true if the current wall-clock time in the configured IANA timezone
 * falls within [AGENT_ACTIVE_START, AGENT_ACTIVE_END). Handles overnight windows
 * (e.g. "22:00"–"06:00").  Defaults to always-active when settings are absent.
 */
function isWithinActiveHours(settings: Record<string, string>): boolean {
  const rawStart = settings['AGENT_ACTIVE_START'];
  const rawEnd   = settings['AGENT_ACTIVE_END'];

  // If neither bound is configured, the executor runs at any hour.
  if (!rawStart && !rawEnd) return true;

  const start = normaliseTime(rawStart ?? '00:00');
  const end   = normaliseTime(rawEnd   ?? '23:59');
  const tz    = settings['AGENT_TIMEZONE'] ?? 'UTC';

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
  } catch {
    // Invalid IANA timezone — fall back to allowing execution
    return true;
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
 * inbox task and returns it to the caller.
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
      'SELECT * FROM tasks WHERE status = ? ORDER BY priority ASC, due_date ASC NULLS LAST LIMIT 50',
    )
    .all('inbox') as TaskRow[];

  if (rows.length === 0) {
    return successResponse({ skip: true, reason: 'no_tasks' });
  }

  // ── Score and pick the top task ──────────────────────────────────────────
  const now = new Date();
  let bestRow: TaskRow = rows[0]!;
  let bestScore = scoreTask(rowToTask(rows[0]!), now);

  for (let i = 1; i < rows.length; i++) {
    const s = scoreTask(rowToTask(rows[i]!), now);
    if (s > bestScore) {
      bestScore = s;
      bestRow = rows[i]!;
    }
  }

  // ── Atomic claim (AND status='inbox' prevents double-claim) ─────────────
  const sessionId = crypto.randomUUID();
  const claimedAt = new Date().toISOString();

  const result = db
    .prepare(
      `UPDATE tasks
          SET status = 'assigned', execution_session_id = ?, updated_at = ?
        WHERE id = ? AND status = 'inbox'`,
    )
    .run(sessionId, claimedAt, bestRow.id);

  if (result.changes === 0) {
    // Race condition — another instance already claimed this task
    return successResponse({ skip: true, reason: 'claimed_by_peer' });
  }

  // ── Record status transition ─────────────────────────────────────────────
  db.prepare(
    `INSERT INTO task_status_changes (task_id, from_status, to_status, changed_at)
     VALUES (?, 'inbox', 'assigned', ?)`,
  ).run(bestRow.id, claimedAt);

  writeAuditLog({
    action: 'task.executor.claim',
    resource: `task:${bestRow.id}`,
    result: 'success',
    ip,
    userAgent,
  });

  // Re-fetch to return the fully updated row
  const claimed = db.prepare('SELECT * FROM tasks WHERE id = ?').get(bestRow.id) as TaskRow | undefined;
  if (!claimed) {
    // Extremely unlikely: task deleted between UPDATE and SELECT
    return successResponse({ skip: true, reason: 'no_tasks' });
  }
  return successResponse({ skip: false, task: rowToTask(claimed) });
}
