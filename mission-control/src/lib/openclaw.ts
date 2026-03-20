// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import fs from 'fs';
import path from 'path';

/** Cron descriptor parsed from openclaw.json. */
export interface OpenClawCron {
  id: string;
  name: string;
  schedule: string;
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

  // Single-agent format
  if (typeof obj['id'] === 'string' && typeof obj['name'] === 'string') {
    return [{
      id: obj['id'],
      name: obj['name'],
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
    }];
  });
}
