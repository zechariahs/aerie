// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/** JWT payload stored in the session cookie. */
export interface SessionPayload {
  sub: 'admin';
  iat: number;
  exp: number;
}

/** Short-lived token issued after password check, before TOTP. */
export interface TempTokenPayload {
  sub: 'admin';
  step: 'totp';
  iat: number;
  exp: number;
}

/** Shape returned by all successful API responses. */
export interface ApiSuccess<T> {
  data: T;
}

/** Shape returned by all failed API responses. */
export interface ApiError {
  error: string;
  code?: string;
}

/** Agent status sourced from Gateway WebSocket or openclaw.json. */
export type AgentStatus = 'ACTIVE' | 'IDLE' | 'ERROR' | 'OFFLINE';

/** Parsed agent descriptor from openclaw.json. */
export interface AgentDescriptor {
  id: string;
  name: string;
  model: string;
  status: AgentStatus;
  color?: string;
}

/** Task priority levels. */
export type TaskPriority = 'P1' | 'P2' | 'P3' | 'P4';

/** Task board columns. */
export type TaskStatus =
  | 'inbox'
  | 'assigned'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'archived';

/** Task tag mirrors workspace folder structure. */
export type TaskTag = 'STG' | 'Personal' | 'CW';

/** Task record as stored in SQLite. */
export interface Task {
  id: string;
  title: string;
  description: string | undefined;
  status: TaskStatus;
  priority: TaskPriority;
  tag: TaskTag | undefined;
  assigned_agent: string | undefined;
  due_date: string | undefined;
  linked_output: string | undefined;
  created_at: string;
  updated_at: string;
}

/** Audit log record as stored in SQLite. */
export interface AuditLogEntry {
  id: number;
  timestamp: string;
  action: string;
  resource: string;
  result: 'success' | 'failure';
  ip: string;
  user_agent: string;
}

/** Brief history record as stored in SQLite. */
export interface BriefHistory {
  id: number;
  title: string;
  drive_url: string;
  created_at: string;
}
