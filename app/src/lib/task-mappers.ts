// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import type {
  Task,
  TaskCapabilityTier,
  TaskClarificationState,
  TaskPriority,
  TaskSource,
  TaskStatus,
  TaskTag,
} from '@/types';

/**
 * Shape of a raw tasks row returned by SQLite queries.
 * Exported so route handlers can type their `.get()` / `.all()` results.
 */
export interface TaskRow {
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

/** Maps a raw SQLite row to a fully-typed Task object. */
export function rowToTask(row: TaskRow): Task {
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
