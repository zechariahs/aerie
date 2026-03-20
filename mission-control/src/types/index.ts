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

// ── VPS Health (Module 7) ────────────────────────────────────────────────────

/** Normalized system metrics returned by /api/vps/metrics. */
export interface VpsMetrics {
  cpuPct: number;
  memUsedMb: number;
  memTotalMb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  networkInBps: number;
  networkOutBps: number;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  uptimeSeconds: number;
  sampledAt: number;
}

/** A single Docker container record returned by /api/vps/docker. */
export interface DockerContainer {
  name: string;
  status: string;
  cpuPct: number;
  memMb: number;
  uptimeSeconds: number;
}

/** Response shape for /api/vps/docker. */
export interface DockerList {
  containers: DockerContainer[];
}

/** Response shape for /api/vps/services. */
export interface VpsServiceStatus {
  nginx: string;
  openclawGateway: boolean;
}

// ── Cost & Token Tracking (Module 3) ────────────────────────────────────────

/** Per-agent, per-model daily cost entry. */
export interface DailyAgentCost {
  date: string;          // YYYY-MM-DD
  agentId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  source: 'openrouter' | 'estimated';
}

/** Price table row for a single model. */
export interface ModelPrice {
  modelId: string;
  inputPer1MTokens: number;   // USD per 1M input tokens
  outputPer1MTokens: number;  // USD per 1M output tokens
  updatedAt: string;          // ISO timestamp
}

/** Individual session cost record (from OpenClaw SQLite or OpenRouter). */
export interface SessionCost {
  sessionId: string;
  agentId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number | undefined;
  startedAt: string;
  source: 'openrouter' | 'estimated';
}

/** Summary numbers for the monthly projection card. */
export interface CostSummary {
  today: number;
  thisWeek: number;
  thisMonth: number;
  projectedMonth: number;
  vsLastMonthPct: number | undefined;
}

/** Row shape for the per-agent summary table. */
export interface AgentCostSummaryRow {
  agentId: string;
  today: number;
  thisWeek: number;
  thisMonth: number;
  avgCostPerSession: number;
  sessionCount: number;
  weeklySparkline: number[];  // 7 data points, oldest first
}

/** Row shape for the per-cron summary table. */
export interface CronCostSummaryRow {
  cronId: string;
  cronName: string;
  avgTokensPerRun: number;
  avgCostPerRun: number;
  totalThisMonth: number;
  runCount: number;
}

/** Paginated session cost response. */
export interface PaginatedSessionCosts {
  items: SessionCost[];
  total: number;
  page: number;
  limit: number;
  agentMeanCost: Record<string, number>;  // agentId → mean cost, used for outlier detection
}
