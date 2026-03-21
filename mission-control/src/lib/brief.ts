// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Assembles Claude context briefs from live dashboard data.
 *
 * Pulls from: cost API, cron run history (mc.db), task board (mc.db),
 * and SESSION-STATE.md from the /openclaw workspace mount.
 *
 * Returns a markdown string formatted for direct paste into a Claude session.
 */

import fs from 'fs';
import path from 'path';
import { getCostSummary } from './cost';
import { getDb } from './db';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface CronRunRow {
  id: string;
  cron_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  output_excerpt: string | null;
  error_message: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  tag: string | null;
  assigned_agent: string | null;
  due_date: string | null;
  updated_at: string;
}

function readSessionState(): string {
  const workspaceDir = path.resolve(process.env['OPENCLAW_DIR'] ?? '/openclaw', 'workspace');
  const filePath = path.join(workspaceDir, 'SESSION-STATE.md');
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '(SESSION-STATE.md not available — workspace mount may be offline)';
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function statusEmoji(status: string): string {
  if (status === 'success') return '✓';
  if (status === 'failure') return '✗';
  if (status === 'running') return '⟳';
  return '?';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assembles the Claude context brief from live dashboard data.
 *
 * Sections assembled:
 * 1. Generated timestamp + operator notes
 * 2. Cost summary (today / week / month / projected)
 * 3. Cron run history (last 3 runs per job)
 * 4. Task board snapshot (active tasks grouped by status)
 * 5. SESSION-STATE.md contents
 *
 * Designed to be written directly to a Google Doc and linked in a Claude session.
 */
export async function assembleBrief(notes: string): Promise<string> {
  const now = new Date();
  const ts = now.toLocaleString('en-US', {
    timeZone: process.env['NEXT_PUBLIC_TIMEZONE'] ?? 'America/Chicago',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const lines: string[] = [];

  // ---------------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------------

  lines.push(`# WintermuteTuring Mission Control Brief`);
  lines.push(`**Generated:** ${ts}`);
  lines.push('');

  if (notes.trim()) {
    lines.push('## Operator Notes');
    lines.push(notes.trim());
    lines.push('');
  }

  // ---------------------------------------------------------------------------
  // Cost summary
  // ---------------------------------------------------------------------------

  lines.push('## Cost Summary');

  try {
    const summary = await getCostSummary();
    lines.push(`| Period | Spend |`);
    lines.push(`|---|---|`);
    lines.push(`| Today | $${summary.today.toFixed(4)} |`);
    lines.push(`| This week | $${summary.thisWeek.toFixed(4)} |`);
    lines.push(`| This month | $${summary.thisMonth.toFixed(4)} |`);
    lines.push(`| Projected month | $${summary.projectedMonth.toFixed(4)} |`);
    if (summary.vsLastMonthPct !== undefined) {
      const dir = summary.vsLastMonthPct >= 0 ? '+' : '';
      lines.push(`| vs Last month | ${dir}${summary.vsLastMonthPct.toFixed(1)}% |`);
    }
  } catch {
    lines.push('_Cost data unavailable._');
  }

  lines.push('');

  // ---------------------------------------------------------------------------
  // Cron run history
  // ---------------------------------------------------------------------------

  lines.push('## Recent Cron Runs');

  try {
    const db = getDb();
    // Last 3 runs per cron, ordered by time desc
    const rows = db
      .prepare(
        `SELECT cr.*
         FROM cron_runs cr
         INNER JOIN (
           SELECT cron_id, MAX(started_at) AS max_started
           FROM cron_runs
           GROUP BY cron_id
         ) latest ON cr.cron_id = latest.cron_id
         ORDER BY cr.cron_id, cr.started_at DESC`,
      )
      .all() as CronRunRow[];

    // Group and take last 3 per cron
    const byCron = new Map<string, CronRunRow[]>();
    for (const row of rows) {
      const existing = byCron.get(row.cron_id) ?? [];
      if (existing.length < 3) {
        existing.push(row);
        byCron.set(row.cron_id, existing);
      }
    }

    if (byCron.size === 0) {
      lines.push('_No cron run history recorded yet._');
    } else {
      for (const [cronId, runs] of byCron.entries()) {
        lines.push(`### ${cronId}`);
        for (const run of runs) {
          const emoji = statusEmoji(run.status);
          const when = new Date(run.started_at).toLocaleString('en-US', {
            timeZone: process.env['NEXT_PUBLIC_TIMEZONE'] ?? 'America/Chicago',
          });
          const dur = formatDuration(run.duration_ms);
          lines.push(`- ${emoji} **${run.status}** — ${when} (${dur})`);
          if (run.error_message) {
            lines.push(`  - Error: ${run.error_message}`);
          }
          if (run.output_excerpt) {
            lines.push(`  - Output: ${run.output_excerpt.slice(0, 200)}`);
          }
        }
        lines.push('');
      }
    }
  } catch {
    lines.push('_Cron run history unavailable._');
    lines.push('');
  }

  // ---------------------------------------------------------------------------
  // Task board snapshot
  // ---------------------------------------------------------------------------

  lines.push('## Task Board');

  try {
    const db = getDb();
    const tasks = db
      .prepare(
        `SELECT id, title, status, priority, tag, assigned_agent, due_date, updated_at
         FROM tasks
         WHERE status NOT IN ('done', 'archived')
         ORDER BY
           CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
           updated_at DESC`,
      )
      .all() as TaskRow[];

    if (tasks.length === 0) {
      lines.push('_No active tasks._');
    } else {
      const byStatus = new Map<string, TaskRow[]>();
      for (const task of tasks) {
        const existing = byStatus.get(task.status) ?? [];
        existing.push(task);
        byStatus.set(task.status, existing);
      }

      const ORDER = ['inbox', 'assigned', 'in_progress', 'review'];
      for (const status of ORDER) {
        const statusTasks = byStatus.get(status);
        if (!statusTasks || statusTasks.length === 0) continue;
        const label = status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        lines.push(`### ${label}`);
        for (const t of statusTasks) {
          const tag = t.tag ? ` [${t.tag}]` : '';
          const agent = t.assigned_agent ? ` → ${t.assigned_agent}` : '';
          const due = t.due_date ? ` (due: ${t.due_date})` : '';
          lines.push(`- **[${t.priority}]** ${t.title}${tag}${agent}${due}`);
        }
        lines.push('');
      }
    }
  } catch {
    lines.push('_Task board unavailable._');
    lines.push('');
  }

  // ---------------------------------------------------------------------------
  // SESSION-STATE.md
  // ---------------------------------------------------------------------------

  lines.push('## SESSION-STATE.md');
  lines.push('');
  lines.push(readSessionState());
  lines.push('');

  return lines.join('\n');
}
