// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import type { TaskStatus } from '@/types';

/** Columns in display order. */
export const TASK_COLUMNS: TaskStatus[] = [
  'inbox',
  'assigned',
  'in_progress',
  'needs_clarification',
  'review',
  'done',
  'archived',
];
