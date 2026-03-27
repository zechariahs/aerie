// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import fs from 'fs';
import path from 'path';
import type { CronJob, CronRun, AgentDescriptor, ProviderModel } from '@/types';
import { getDb } from './db';

// ── Raw config types ─────────────────────────────────────────────────────────

/** Cron descriptor parsed from openclaw.json. */
export interface OpenClawCron {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  modelOverride?: string;
}

// ── Raw cron/jobs.json types ──────────────────────────────────────────────────

interface RawCronSchedule {
  kind: string;
  expr: string;
  tz?: string;
}

interface RawCronPayload {
  kind: string;
  model?: string;
  message?: string;
  timeoutSeconds?: number;
}

interface RawCronState {
  lastRunStatus?: string;
  lastRunAtMs?: number;
  consecutiveErrors?: number;
  lastError?: string;
}

export interface RawCronJob {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  schedule: RawCronSchedule;
  payload?: RawCronPayload;
  state?: RawCronState;
}

interface RawCronJobsFile {
  version: number;
  jobs: RawCronJob[];
}

/** Agent descriptor parsed from openclaw.json. */
export interface OpenClawAgent {
  id: string;
  name: string;
  model: string;
}

/** Minimal parsed view of openclaw.json. */
export interface OpenClawConfig {
  agents: OpenClawAgent[];
  crons: OpenClawCron[];
  providerModels: ProviderModel[];
}

// ── Core parser ──────────────────────────────────────────────────────────────

/**
 * Reads and parses openclaw.json from the mounted /openclaw directory.
 * Returns a minimal view of agents and crons. Falls back to empty arrays
 * if the file is absent or malformed — dashboard must degrade gracefully.
 */
export function readOpenClawConfig(): OpenClawConfig {
  const clawDir = process.env['OPENCLAW_DIR'] ?? '/openclaw';
  const configPath = path.join(clawDir, 'openclaw.json');

  let raw: unknown;
  try {
    const text = fs.readFileSync(configPath, 'utf8');
    raw = JSON.parse(text) as unknown;
  } catch {
    return { agents: [], crons: [], providerModels: [] };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { agents: [], crons: [], providerModels: [] };
  }

  const obj = raw as Record<string, unknown>;

  const agents = parseAgents(obj);
  const crons = parseCrons(obj);
  const providerModels = parseProviderModels(obj);

  return { agents, crons, providerModels };
}

function parseAgents(obj: Record<string, unknown>): OpenClawAgent[] {
  // openclaw.json may use "agents" array or a top-level "agent" object
  if (Array.isArray(obj['agents'])) {
    return (obj['agents'] as unknown[]).flatMap((a) => {
      if (typeof a !== 'object' || a === null) return [];
      const agent = a as Record<string, unknown>;
      if (typeof agent['id'] !== 'string' || typeof agent['name'] !== 'string') return [];
      return [{
        id: agent['id'],
        name: agent['name'],
        model: typeof agent['model'] === 'string' ? agent['model'] : '',
      }];
    });
  }

  // Single-agent format: top-level agent_id + name
  const agentId = obj['agent_id'] ?? obj['id'];
  const agentName = obj['agent_name'] ?? obj['name'];
  if (typeof agentId === 'string' && typeof agentName === 'string') {
    return [{
      id: agentId,
      name: agentName,
      model: typeof obj['model'] === 'string' ? obj['model'] : '',
    }];
  }

  return [];
}

function parseCrons(obj: Record<string, unknown>): OpenClawCron[] {
  const cronSource = Array.isArray(obj['crons'])
    ? (obj['crons'] as unknown[])
    : [];

  return cronSource.flatMap((c) => {
    if (typeof c !== 'object' || c === null) return [];
    const cron = c as Record<string, unknown>;
    if (typeof cron['id'] !== 'string' || typeof cron['name'] !== 'string') return [];
    return [{
      id: cron['id'],
      name: cron['name'],
      schedule: typeof cron['schedule'] === 'string' ? cron['schedule'] : '',
      enabled: cron['enabled'] !== false, // default true if absent
      modelOverride: typeof cron['model_override'] === 'string' ? cron['model_override'] : undefined,
    }];
  });
}

function parseProviderModels(obj: Record<string, unknown>): ProviderModel[] {
  const modelsSection = obj['models'];
  if (typeof modelsSection !== 'object' || modelsSection === null) return [];

  const providers = (modelsSection as Record<string, unknown>)['providers'];
  if (typeof providers !== 'object' || providers === null) return [];

  const result: ProviderModel[] = [];
  for (const [providerKey, providerData] of Object.entries(providers as Record<string, unknown>)) {
    if (typeof providerData !== 'object' || providerData === null) continue;
    const pd = providerData as Record<string, unknown>;
    const models = pd['models'];
    if (!Array.isArray(models)) continue;

    for (const m of models) {
      if (typeof m !== 'object' || m === null) continue;
      const model = m as Record<string, unknown>;
      if (typeof model['id'] !== 'string' || typeof model['name'] !== 'string') continue;

      let cost: ProviderModel['cost'] | undefined;
      if (typeof model['cost'] === 'object' && model['cost'] !== null) {
        const c = model['cost'] as Record<string, unknown>;
        cost = {
          input: typeof c['input'] === 'number' ? c['input'] : 0,
          output: typeof c['output'] === 'number' ? c['output'] : 0,
          cacheRead: typeof c['cacheRead'] === 'number' ? c['cacheRead'] : 0,
          cacheWrite: typeof c['cacheWrite'] === 'number' ? c['cacheWrite'] : 0,
        };
      }

      result.push({ id: model['id'], name: model['name'], provider: providerKey, cost });
    }
  }

  return result;
}

// ── Higher-level helpers (session-3: Cron Manager) ───────────────────────────

/**
 * Reads cron job definitions from OPENCLAW_DIR/cron/jobs.json.
 * Returns an empty array if the file is absent or malformed.
 */
export function readCronJobsFile(): RawCronJob[] {
  const clawDir = process.env['OPENCLAW_DIR'] ?? '/openclaw';
  const jobsPath = path.join(clawDir, 'cron', 'jobs.json');

  let raw: unknown;
  try {
    const text = fs.readFileSync(jobsPath, 'utf8');
    raw = JSON.parse(text) as unknown;
  } catch {
    console.error('[openclaw] Could not read cron/jobs.json');
    return [];
  }

  if (typeof raw !== 'object' || raw === null) return [];
  const file = raw as RawCronJobsFile;
  return Array.isArray(file.jobs) ? file.jobs : [];
}

/**
 * Returns all cron jobs from cron/jobs.json, enriched with the latest run
 * status from mc.db. Falls back to fixture data in dev mode.
 */
export function getCronJobs(): CronJob[] {
  if (process.env['USE_FIXTURES'] === 'true') {
    return loadCronFixtures();
  }

  const rawJobs = readCronJobsFile();
  if (rawJobs.length === 0) return [];

  return rawJobs.map((raw): CronJob => {
    const lastRuns = readCronRuns(raw.id, 1);
    const lastRunEntry = lastRuns[0];

    let derivedStatus: CronJob['status'] = raw.enabled ? 'active' : 'disabled';
    if (lastRunEntry?.status === 'running') derivedStatus = 'running';

    return {
      id: raw.id,
      name: raw.name,
      schedule: raw.schedule.expr,
      scheduleTz: raw.schedule.tz,
      enabled: raw.enabled,
      agentId: raw.agentId,
      modelOverride: raw.payload?.model,
      prompt: raw.payload?.message,
      status: derivedStatus,
      lastRun: lastRunEntry
        ? {
            runId: lastRunEntry.id,
            status: lastRunEntry.status,
            startedAt: lastRunEntry.startedAt,
            durationMs: lastRunEntry.durationMs,
          }
        : undefined,
    };
  });
}

/**
 * Returns the last N run entries for a cron job, newest-first.
 * Queries mc.db (populated by the ingestion pipeline) as the primary source.
 */
export function readCronRuns(cronId: string, limit: number): CronRun[] {
  type Row = {
    id: string;
    cron_id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    duration_ms: number | null;
    output_excerpt: string | null;
    drive_url: string | null;
    error_message: string | null;
    run_at_ms: number | null;
    model: string | null;
    provider: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  };

  const rows = getDb()
    .prepare<[string, number], Row>(
      `SELECT * FROM cron_runs
       WHERE cron_id = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(cronId, limit);

  return rows.map((row): CronRun => {
    const rawStatus = row.status;
    const status: CronRun['status'] =
      rawStatus === 'success' || rawStatus === 'running' ? rawStatus : 'failure';

    return {
      id: row.id,
      cronId: row.cron_id,
      status,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      outputExcerpt: row.output_excerpt ?? undefined,
      driveUrl: row.drive_url ?? undefined,
      errorMessage: row.error_message ?? undefined,
      runAtMs: row.run_at_ms ?? undefined,
      model: row.model ?? undefined,
      provider: row.provider ?? undefined,
      usage:
        row.input_tokens != null && row.output_tokens != null
          ? {
              input_tokens: row.input_tokens,
              output_tokens: row.output_tokens,
              total_tokens: row.total_tokens ?? undefined,
            }
          : undefined,
    };
  });
}

/**
 * Returns all agent descriptors from openclaw.json.
 * Falls back to a single default stub if the config is unavailable.
 * Supports multi-agent layouts from day one.
 */
export function getAgents(): AgentDescriptor[] {
  if (process.env['USE_FIXTURES'] === 'true') {
    return [
      {
        id: 'primary-agent',
        name: process.env['NEXT_PUBLIC_AGENT_NAME'] ?? 'Agent',
        model: 'openrouter/moonshotai/kimi-k2-0905',
        status: 'IDLE',
      },
    ];
  }

  const config = readOpenClawConfig();
  if (config.agents.length === 0) {
    return [
      {
        id: 'unknown',
        name: process.env['NEXT_PUBLIC_AGENT_NAME'] ?? 'Agent',
        model: 'unknown',
        status: 'OFFLINE',
      },
    ];
  }

  return config.agents.map((agent): AgentDescriptor => ({
    id: agent.id,
    name: agent.name,
    model: agent.model,
    // status is overlaid from live Gateway state at render time
    status: 'IDLE',
  }));
}

/**
 * Returns the primary agent descriptor from openclaw.json,
 * or a default stub if the config is unavailable.
 */
export function getAgentDescriptor(): AgentDescriptor {
  if (process.env['USE_FIXTURES'] === 'true') {
    return {
      id: 'primary-agent',
      name: process.env['NEXT_PUBLIC_AGENT_NAME'] ?? 'Agent',
      model: 'openrouter/moonshotai/kimi-k2-0905',
      status: 'IDLE',
    };
  }

  const config = readOpenClawConfig();
  const agent = config.agents[0];
  if (!agent) {
    return {
      id: 'unknown',
      name: process.env['NEXT_PUBLIC_AGENT_NAME'] ?? 'Agent',
      model: 'unknown',
      status: 'OFFLINE',
    };
  }

  return {
    id: agent.id,
    name: agent.name,
    model: agent.model,
    status: 'IDLE',
  };
}

/**
 * Returns the raw payload object for a cron job by ID, used by the API route
 * to spread existing payload fields when updating the prompt via cron.update.
 * Returns an empty object if the job is not found or running in fixture mode.
 */
export function getRawCronPayload(cronId: string): Record<string, unknown> {
  if (process.env['USE_FIXTURES'] === 'true') return {};
  const jobs = readCronJobsFile();
  const job = jobs.find((j) => j.id === cronId);
  return (job?.payload ?? {}) as Record<string, unknown>;
}

// ── Fixture helpers ───────────────────────────────────────────────────────────

interface CronFixtureFile {
  jobs: CronJob[];
}

function loadCronFixtures(): CronJob[] {
  try {
    const fixturePath = path.join(process.cwd(), 'fixtures', 'crons.json');
    const raw = fs.readFileSync(fixturePath, 'utf-8');
    const parsed = JSON.parse(raw) as CronFixtureFile;
    return parsed.jobs;
  } catch {
    return [];
  }
}
