// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type {
  DailyAgentCost,
  ModelPrice,
  ProviderModel,
  SessionCost,
  CostSummary,
  AgentCostSummaryRow,
  CronCostSummaryRow,
  PaginatedSessionCosts,
} from '@/types';
import { readOpenClawConfig } from './openclaw';
import { getDb } from './db';

const DEFAULT_AGENT_ID = 'primary-agent';

const DEFAULT_PRICE_TABLE: ModelPrice[] = [
  {
    modelId: 'moonshotai/kimi-k2-0905',
    inputPer1MTokens: 0.15,
    outputPer1MTokens: 2.0,
    cacheReadPer1MTokens: 0.015, // 10% of input rate
    updatedAt: new Date().toISOString(),
  },
  {
    modelId: 'anthropic/claude-haiku-4-5',
    inputPer1MTokens: 0.8,
    outputPer1MTokens: 4.0,
    cacheReadPer1MTokens: 0.08, // 10% of input rate
    updatedAt: new Date().toISOString(),
  },
  {
    modelId: 'anthropic/claude-sonnet-4-5',
    inputPer1MTokens: 3.0,
    outputPer1MTokens: 15.0,
    cacheReadPer1MTokens: 0.30, // 10% of input rate
    updatedAt: new Date().toISOString(),
  },
];


/** Resolves the path for storing the price table on disk. */
function priceTablePath(): string {
  const dataDir = process.env['MC_DATA_DIR'] ?? '/app/data';
  return path.join(dataDir, 'price-table.json');
}

/**
 * Loads the price table from /app/data/price-table.json.
 * Returns defaults (pre-populated with known OpenRouter models) if file absent or unreadable.
 */
export function loadPriceTable(): ModelPrice[] {
  try {
    const text = fs.readFileSync(priceTablePath(), 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_PRICE_TABLE;
    const valid = (parsed as unknown[]).filter(isModelPrice);
    return valid.length > 0 ? valid : DEFAULT_PRICE_TABLE;
  } catch {
    return DEFAULT_PRICE_TABLE;
  }
}

/**
 * Saves the price table to /app/data/price-table.json.
 * Creates the data directory if absent.
 */
export function savePriceTable(table: ModelPrice[]): void {
  const p = priceTablePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(table, null, 2), 'utf8');
}

/**
 * Computes estimated cost in USD from token counts and the price table.
 * If `options.totalTokens` is provided, infers cache-read tokens as
 * (totalTokens - outputTokens - inputTokens) and prices them at the
 * cache-read rate (10% of input rate by default).
 * Checks the provider model registry first for models with explicit cost data
 * (e.g. Nexos free models), then falls back to the price table.
 * Returns 0 if the model is not found in either source.
 */
export function computeCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  priceTable: ModelPrice[],
  options?: { totalTokens?: number; providerModels?: ProviderModel[] },
): number {
  const cacheReadTokens = options?.totalTokens !== undefined
    ? Math.max(0, options.totalTokens - outputTokens - inputTokens)
    : 0;

  // Check provider registry first — models with explicit cost data (e.g. Nexos $0)
  if (options?.providerModels) {
    const pm = options.providerModels.find(
      (m) => `${m.provider}/${m.name}` === modelId,
    );
    if (pm?.cost !== undefined) {
      return (
        (inputTokens / 1_000_000) * pm.cost.input +
        (cacheReadTokens / 1_000_000) * pm.cost.cacheRead +
        (outputTokens / 1_000_000) * pm.cost.output
      );
    }
  }

  // Fall back to price table
  const unprefixed = modelId.replace(/^openrouter\//, '');
  const row = priceTable.find(
    (r) =>
      r.modelId === modelId ||
      r.modelId === `openrouter/${modelId}` ||
      r.modelId === unprefixed,
  );
  if (!row) return 0;

  const cacheReadRate = row.cacheReadPer1MTokens ?? row.inputPer1MTokens * 0.1;
  return (
    (inputTokens / 1_000_000) * row.inputPer1MTokens +
    (cacheReadTokens / 1_000_000) * cacheReadRate +
    (outputTokens / 1_000_000) * row.outputPer1MTokens
  );
}

/**
 * OpenRouter /api/v1/usage returns an HTML page, not JSON — this is a no-op stub.
 * @deprecated Use getCostsFromCronRuns() instead.
 */
export async function getOpenRouterDailyCosts(_days: number): Promise<DailyAgentCost[]> {
  return [];
}

/**
 * Returns daily cost data by querying the mc.db cron_runs table.
 * Data is populated by the ingestion pipeline (ingest.ts) which runs on
 * startup and every 5 minutes. SQLite is the cache — no in-memory layer needed.
 */
export function getCostsFromCronRuns(days: number): DailyAgentCost[] {
  if (process.env['USE_FIXTURES'] === 'true') return [];

  const priceTable = loadPriceTable();
  const { providerModels } = readOpenClawConfig();
  const cutoff = toDateString(daysAgo(days));

  type Row = {
    date: string;
    agent_id: string | null;
    model: string | null;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number | null;
  };

  const rows = getDb()
    .prepare<[string], Row>(
      `SELECT
         substr(started_at, 1, 10) AS date,
         agent_id,
         model,
         CAST(SUM(input_tokens)  AS INTEGER) AS input_tokens,
         CAST(SUM(output_tokens) AS INTEGER) AS output_tokens,
         CAST(SUM(total_tokens)  AS INTEGER) AS total_tokens
       FROM cron_runs
       WHERE started_at >= ?
         AND input_tokens IS NOT NULL
       GROUP BY date, agent_id, model
       ORDER BY date ASC`,
    )
    .all(cutoff);

  return rows.map((row): DailyAgentCost => {
    const modelId = row.model ?? 'unknown';
    const inputTokens = row.input_tokens ?? 0;
    const outputTokens = row.output_tokens ?? 0;
    const costUsd = computeCost(inputTokens, outputTokens, modelId, priceTable, {
      totalTokens: row.total_tokens ?? undefined,
      providerModels,
    });
    return {
      date: row.date,
      agentId: row.agent_id ?? 'unknown',
      modelId,
      inputTokens,
      outputTokens,
      costUsd,
      source: 'estimated',
    };
  });
}

/**
 * Returns per-cron cost summary rows for the given month start (YYYY-MM-DD).
 * Used by the /api/costs/crons endpoint and CronSummaryTable component.
 */
export function getCronRunSummaryRows(monthStart: string): Array<{
  cronId: string;
  runCount: number;
  totalInput: number;
  totalOutput: number;
  totalAllTokens: number;
  avgTokensPerRun: number;
}> {
  if (process.env['USE_FIXTURES'] === 'true') return [];

  type Row = {
    cron_id: string;
    run_count: number;
    total_input: number;
    total_output: number;
    total_all_tokens: number | null;
    avg_tokens_per_run: number;
  };

  const rows = getDb()
    .prepare<[string], Row>(
      `SELECT
         cron_id,
         COUNT(*)                                    AS run_count,
         CAST(SUM(input_tokens)  AS INTEGER)         AS total_input,
         CAST(SUM(output_tokens) AS INTEGER)         AS total_output,
         CAST(SUM(total_tokens)  AS INTEGER)         AS total_all_tokens,
         AVG(input_tokens + output_tokens)           AS avg_tokens_per_run
       FROM cron_runs
       WHERE started_at >= ?
         AND input_tokens IS NOT NULL
       GROUP BY cron_id`,
    )
    .all(monthStart);

  return rows.map((row) => ({
    cronId: row.cron_id,
    runCount: row.run_count,
    totalInput: row.total_input ?? 0,
    totalOutput: row.total_output ?? 0,
    totalAllTokens: row.total_all_tokens ?? 0,
    avgTokensPerRun: Math.round(row.avg_tokens_per_run ?? 0),
  }));
}

/**
 * Reads session cost data from the OpenClaw SQLite database.
 * Discovers the sessions DB by listing /openclaw/db/ — filename may change
 * between OpenClaw versions so we never hardcode it.
 * Returns an empty array if the DB is absent, locked, or schema differs.
 */
export function getSessionCostsFromSqlite(days: number): SessionCost[] {
  if (process.env['USE_FIXTURES'] === 'true') return [];

  const clawDir = process.env['OPENCLAW_DIR'] ?? '/openclaw';
  const dbDir = path.join(clawDir, 'db');

  let dbFiles: string[];
  try {
    dbFiles = fs.readdirSync(dbDir).filter((f) => f.endsWith('.db'));
  } catch {
    return [];
  }

  if (dbFiles.length === 0) return [];

  const dbPath = path.join(dbDir, dbFiles[0]!);
  const priceTable = loadPriceTable();

  try {
    // Open read-only to avoid locking the agent's own database
    const db = new Database(dbPath, { readonly: true });

    // Discover schema — don't assume column names
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all() as Array<{ name: string }>;

    const hasSessionsTable = tables.some((t) => t.name === 'sessions');
    if (!hasSessionsTable) {
      db.close();
      return [];
    }

    const cols = db
      .prepare(`PRAGMA table_info(sessions)`)
      .all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));

    // Require minimum columns; adapt to whatever is present
    const hasRequired =
      colNames.has('id') &&
      (colNames.has('started_at') || colNames.has('created_at'));
    if (!hasRequired) {
      db.close();
      return [];
    }

    const startedAtCol = colNames.has('started_at') ? 'started_at' : 'created_at';
    const cutoff = toDateString(daysAgo(days));

    const rows = db
      .prepare(
        `SELECT * FROM sessions WHERE ${startedAtCol} >= ? ORDER BY ${startedAtCol} DESC`,
      )
      .all(cutoff) as Array<Record<string, unknown>>;

    db.close();

    return rows.flatMap((row): SessionCost[] => {
      const sessionId = String(row['id'] ?? '');
      const agentId = typeof row['agent_id'] === 'string' ? row['agent_id'] : DEFAULT_AGENT_ID;
      const modelId = typeof row['model'] === 'string' ? row['model'] : '';
      const inputTokens = Number(row['input_tokens'] ?? row['prompt_tokens'] ?? 0);
      const outputTokens = Number(row['output_tokens'] ?? row['completion_tokens'] ?? 0);
      const durationMs =
        row['duration_ms'] !== undefined ? Number(row['duration_ms']) : undefined;
      const startedAt = String(row[startedAtCol] ?? '');
      const cost = computeCost(inputTokens, outputTokens, modelId, priceTable);

      if (!startedAt) return [];

      return [{
        sessionId,
        agentId,
        modelId,
        inputTokens,
        outputTokens,
        costUsd: cost,
        durationMs,
        startedAt,
        source: 'estimated',
      }];
    });
  } catch {
    return [];
  }
}

/**
 * Returns merged daily costs. Cron JSONL run files are the primary source;
 * SQLite sessions aggregated with the price table fill any gaps.
 */
export async function getMergedCosts(days: number): Promise<DailyAgentCost[]> {
  if (process.env['USE_FIXTURES'] === 'true') {
    return loadFixtureDailyCosts();
  }

  const cronCosts = getCostsFromCronRuns(days);
  if (cronCosts.length > 0) return cronCosts;

  // Fall back: aggregate SQLite sessions into daily buckets
  const sessions = getSessionCostsFromSqlite(days);
  return aggregateSessionsToDaily(sessions);
}

/**
 * Returns paginated session costs from SQLite (or fixtures in dev mode).
 */
export async function getPaginatedSessions({
  agentId,
  days,
  page,
  limit,
}: {
  agentId?: string;
  days: number;
  page: number;
  limit: number;
}): Promise<PaginatedSessionCosts> {
  let sessions: SessionCost[];

  if (process.env['USE_FIXTURES'] === 'true') {
    sessions = loadFixtureSessions();
  } else {
    sessions = getSessionCostsFromSqlite(days);
  }

  if (agentId) {
    sessions = sessions.filter((s) => s.agentId === agentId);
  }

  const total = sessions.length;
  const offset = (page - 1) * limit;
  const items = sessions.slice(offset, offset + limit);

  // Compute per-agent mean cost for outlier detection in the UI
  const agentMeanCost: Record<string, number> = {};
  const byAgent: Record<string, number[]> = {};
  for (const s of sessions) {
    if (!byAgent[s.agentId]) byAgent[s.agentId] = [];
    byAgent[s.agentId]!.push(s.costUsd);
  }
  for (const [aid, costs] of Object.entries(byAgent)) {
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    agentMeanCost[aid] = mean;
  }

  return { items, total, page, limit, agentMeanCost };
}

/**
 * Returns cost summary figures: today, this week, this month, projected month-end,
 * and percentage change vs. last month.
 */
export async function getCostSummary(): Promise<CostSummary> {
  if (process.env['USE_FIXTURES'] === 'true') {
    return loadFixtureSummary();
  }

  const now = new Date();
  const todayStr = toDateString(now);
  const weekStart = toDateString(daysAgo(7));
  const monthStart = toDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  const lastMonthStart = toDateString(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastMonthEnd = toDateString(new Date(now.getFullYear(), now.getMonth(), 0));

  // Primary: cron JSONL run files; fallback: SQLite sessions
  const daily = getCostsFromCronRuns(62);
  const useDailySource = daily.length > 0;

  const today = useDailySource
    ? daily.filter((d) => d.date === todayStr).reduce((sum, d) => sum + d.costUsd, 0)
    : getSessionCostsFromSqlite(1).filter((s) => s.startedAt.startsWith(todayStr)).reduce((sum, s) => sum + s.costUsd, 0);

  const thisWeek = useDailySource
    ? daily.filter((d) => d.date >= weekStart).reduce((sum, d) => sum + d.costUsd, 0)
    : getSessionCostsFromSqlite(7).filter((s) => s.startedAt >= weekStart).reduce((sum, s) => sum + s.costUsd, 0);

  const allDaily = useDailySource ? daily : aggregateSessionsToDaily(getSessionCostsFromSqlite(62));

  const thisMonth = allDaily
    .filter((d) => d.date >= monthStart)
    .reduce((sum, d) => sum + d.costUsd, 0);

  const lastMonth = allDaily
    .filter((d) => d.date >= lastMonthStart && d.date <= lastMonthEnd)
    .reduce((sum, d) => sum + d.costUsd, 0);

  // Projection: scale current month's spend by fraction of month elapsed
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedMonth = dayOfMonth > 0 ? (thisMonth / dayOfMonth) * daysInMonth : thisMonth;

  const vsLastMonthPct =
    lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : undefined;

  return { today, thisWeek, thisMonth, projectedMonth, vsLastMonthPct };
}

/**
 * Computes per-agent summary rows from daily cost data.
 */
export function buildAgentSummaryRows(daily: DailyAgentCost[], sessions: SessionCost[]): AgentCostSummaryRow[] {
  const agentIds = [...new Set(daily.map((d) => d.agentId))];
  const now = new Date();
  const todayStr = toDateString(now);
  const weekDates = Array.from({ length: 7 }, (_, i) => toDateString(daysAgo(6 - i)));
  const monthStart = toDateString(new Date(now.getFullYear(), now.getMonth(), 1));

  return agentIds.map((id) => {
    const agentDaily = daily.filter((d) => d.agentId === id);
    const agentSessions = sessions.filter((s) => s.agentId === id);

    const today = agentDaily
      .filter((d) => d.date === todayStr)
      .reduce((sum, d) => sum + d.costUsd, 0);

    const thisWeek = agentDaily
      .filter((d) => weekDates.includes(d.date))
      .reduce((sum, d) => sum + d.costUsd, 0);

    const thisMonth = agentDaily
      .filter((d) => d.date >= monthStart)
      .reduce((sum, d) => sum + d.costUsd, 0);

    const sessionCount = agentSessions.length;
    const avgCostPerSession =
      sessionCount > 0
        ? agentSessions.reduce((sum, s) => sum + s.costUsd, 0) / sessionCount
        : 0;

    const weeklySparkline = weekDates.map((date) =>
      agentDaily
        .filter((d) => d.date === date)
        .reduce((sum, d) => sum + d.costUsd, 0),
    );

    return { agentId: id, today, thisWeek, thisMonth, avgCostPerSession, sessionCount, weeklySparkline };
  });
}

/**
 * Computes per-cron summary rows from session data.
 * Cron association is inferred from the session's agentId + model (best effort).
 */
export function buildCronSummaryRows(
  sessions: SessionCost[],
  crons: Array<{ id: string; name: string }>,
): CronCostSummaryRow[] {
  const now = new Date();
  const monthStart = toDateString(new Date(now.getFullYear(), now.getMonth(), 1));

  return crons.map((cron) => {
    // Sessions tagged with cron_id if OpenClaw stores it — fall back to name match
    const cronSessions = sessions.filter(
      (s) =>
        (s as SessionCost & { cronId?: string }).cronId === cron.id ||
        s.sessionId.includes(cron.id),
    );

    const thisMonthSessions = cronSessions.filter((s) => s.startedAt >= monthStart);
    const runCount = thisMonthSessions.length;
    const totalThisMonth = thisMonthSessions.reduce((sum, s) => sum + s.costUsd, 0);
    const avgTokensPerRun =
      runCount > 0
        ? thisMonthSessions.reduce((sum, s) => sum + s.inputTokens + s.outputTokens, 0) /
          runCount
        : 0;
    const avgCostPerRun = runCount > 0 ? totalThisMonth / runCount : 0;

    return {
      cronId: cron.id,
      cronName: cron.name,
      avgTokensPerRun: Math.round(avgTokensPerRun),
      avgCostPerRun,
      totalThisMonth,
      runCount,
    };
  });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function aggregateSessionsToDaily(sessions: SessionCost[]): DailyAgentCost[] {
  const map = new Map<string, DailyAgentCost>();

  for (const s of sessions) {
    const date = s.startedAt.slice(0, 10);
    const key = `${date}::${s.agentId}::${s.modelId}`;
    const existing = map.get(key);
    if (existing) {
      existing.inputTokens += s.inputTokens;
      existing.outputTokens += s.outputTokens;
      existing.costUsd += s.costUsd;
    } else {
      map.set(key, {
        date,
        agentId: s.agentId,
        modelId: s.modelId,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        costUsd: s.costUsd,
        source: 'estimated',
      });
    }
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}


function isModelPrice(v: unknown): v is ModelPrice {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj['modelId'] === 'string' &&
    typeof obj['inputPer1MTokens'] === 'number' &&
    typeof obj['outputPer1MTokens'] === 'number' &&
    typeof obj['updatedAt'] === 'string'
  );
}

// ---------------------------------------------------------------------------
// Fixture loaders (dev mode only)
// ---------------------------------------------------------------------------

interface FixtureFile {
  daily: DailyAgentCost[];
  sessions: SessionCost[];
  summary: CostSummary;
}

function loadFixtureFile(): FixtureFile {
  try {
    const p = path.resolve(process.cwd(), 'fixtures', 'costs.json');
    const text = fs.readFileSync(p, 'utf8');
    return JSON.parse(text) as FixtureFile;
  } catch {
    return {
      daily: [],
      sessions: [],
      summary: { today: 0, thisWeek: 0, thisMonth: 0, projectedMonth: 0, vsLastMonthPct: undefined },
    };
  }
}

function loadFixtureDailyCosts(): DailyAgentCost[] {
  return loadFixtureFile().daily;
}

function loadFixtureSessions(): SessionCost[] {
  return loadFixtureFile().sessions;
}

function loadFixtureSummary(): CostSummary {
  return loadFixtureFile().summary;
}
