// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import fs from 'fs';
import path from 'path';
import type { CronJob, CronRun, AgentDescriptor } from '@/types';
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

interface RawCronJob {
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
    return { agents: [], crons: [] };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { agents: [], crons: [] };
  }

  const obj = raw as Record<string, unknown>;

  const agents = parseAgents(obj);
  const crons = parseCrons(obj);

  return { agents, crons };
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

// ── Higher-level helpers (session-3: Cron Manager) ───────────────────────────

/**
 * Reads cron job definitions from OPENCLAW_DIR/cron/jobs.json.
 * Returns an empty array if the file is absent or malformed.
 */
function readCronJobsFile(): RawCronJob[] {
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

  const db = getDb();

  return rawJobs.map((raw): CronJob => {
    const lastRunRow = db
      .prepare(
        `SELECT id, status, started_at, duration_ms
         FROM cron_runs
         WHERE cron_id = ?
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .get(raw.id) as
      | { id: string; status: string; started_at: string; duration_ms: number | null }
      | undefined;

    let derivedStatus: CronJob['status'] = raw.enabled ? 'active' : 'disabled';
    if (lastRunRow?.status === 'running') derivedStatus = 'running';

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
      lastRun: lastRunRow
        ? {
            runId: lastRunRow.id,
            status: lastRunRow.status as 'success' | 'failure' | 'running',
            startedAt: lastRunRow.started_at,
            durationMs: lastRunRow.duration_ms ?? undefined,
          }
        : undefined,
    };
  });
}

/**
 * Reads the last N run entries for a cron job from
 * OPENCLAW_DIR/cron/runs/<cronId>.jsonl, newest-first.
 */
export function readCronRuns(cronId: string, limit: number): CronRun[] {
  const clawDir = process.env['OPENCLAW_DIR'] ?? '/openclaw';
  const runsPath = path.join(clawDir, 'cron', 'runs', `${cronId}.jsonl`);

  let text: string;
  try {
    text = fs.readFileSync(runsPath, 'utf8');
  } catch {
    return [];
  }

  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const tail = lines.slice(-limit).reverse();

  return tail.flatMap((line): CronRun[] => {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return [];
    }

    const id = typeof obj['id'] === 'string' ? obj['id'] : crypto.randomUUID();
    const rawStatus = typeof obj['status'] === 'string' ? obj['status'] : 'failure';
    const status: CronRun['status'] =
      rawStatus === 'success' || rawStatus === 'running' ? rawStatus : 'failure';

    const rawUsage = typeof obj['usage'] === 'object' && obj['usage'] !== null
      ? obj['usage'] as Record<string, unknown>
      : null;

    return [{
      id,
      cronId,
      status,
      startedAt:
        typeof obj['startedAt'] === 'string'
          ? obj['startedAt']
          : typeof obj['started_at'] === 'string'
          ? obj['started_at']
          : new Date().toISOString(),
      finishedAt:
        typeof obj['finishedAt'] === 'string' ? obj['finishedAt'] :
        typeof obj['finished_at'] === 'string' ? obj['finished_at'] : undefined,
      durationMs:
        typeof obj['durationMs'] === 'number' ? obj['durationMs'] :
        typeof obj['duration_ms'] === 'number' ? obj['duration_ms'] : undefined,
      outputExcerpt: typeof obj['outputExcerpt'] === 'string' ? obj['outputExcerpt'] : undefined,
      driveUrl: typeof obj['driveUrl'] === 'string' ? obj['driveUrl'] : undefined,
      errorMessage:
        typeof obj['errorMessage'] === 'string' ? obj['errorMessage'] :
        typeof obj['error'] === 'string' ? obj['error'] : undefined,
      runAtMs: typeof obj['runAtMs'] === 'number' ? obj['runAtMs'] : undefined,
      model: typeof obj['model'] === 'string' ? obj['model'] : undefined,
      provider: typeof obj['provider'] === 'string' ? obj['provider'] : undefined,
      usage: rawUsage
        ? {
            input_tokens: typeof rawUsage['input_tokens'] === 'number' ? rawUsage['input_tokens'] : 0,
            output_tokens: typeof rawUsage['output_tokens'] === 'number' ? rawUsage['output_tokens'] : 0,
          }
        : undefined,
    }];
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
