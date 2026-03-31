// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import type { Task } from '@/types';

/**
 * Scores a task based on priority and due-date proximity.
 * Higher score = higher priority for the executor.
 *
 * +50  if P1, +30 if P2, +10 if P3, +0 if P4
 * +100 if overdue (due_date < now)
 * +40  if due within 4 h (and not overdue)
 * +20  if due within 24 h (and not within 4 h)
 */
export function scoreTask(task: Task, now: Date): number {
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
