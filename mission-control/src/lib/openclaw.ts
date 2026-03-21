// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import fs from 'fs';
import path from 'path';
import type { CronJob, AgentDescriptor } from '@/types';
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
 * Returns all cron jobs from openclaw.json, enriched with the latest run
 * status from mc.db. Falls back to fixture data in dev mode.
 */
export function getCronJobs(): CronJob[] {
  if (process.env['USE_FIXTURES'] === 'true') {
    return loadCronFixtures();
  }

  const config = readOpenClawConfig();
  if (config.crons.length === 0) return [];

  const agentId = config.agents[0]?.id ?? 'unknown';
  const db = getDb();

  return config.crons.map((raw): CronJob => {
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
      schedule: raw.schedule,
      enabled: raw.enabled,
      agentId,
      modelOverride: raw.modelOverride,
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
 * Returns the primary agent descriptor from openclaw.json,
 * or a default stub if the config is unavailable.
 */
export function getAgentDescriptor(): AgentDescriptor {
  if (process.env['USE_FIXTURES'] === 'true') {
    return {
      id: 'wintermute',
      name: process.env['NEXT_PUBLIC_AGENT_NAME'] ?? 'WintermuteTuring',
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
