// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * JSONL → SQLite incremental ingestion engine.
 *
 * Reads new bytes from each cron run JSONL file since the last ingestion
 * (tracked by byte offset in the ingestion_state table) and upserts them
 * into mc.db's cron_runs table. This makes all subsequent cost queries
 * O(SQL) instead of O(JSONL lines scanned).
 *
 * Called synchronously during getDb() startup for the first pass,
 * then on a 5-minute interval via startIngestion().
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from './db';
import { readCronJobsFile, readOpenClawConfig } from './openclaw';
import type { ProviderModel } from '@/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let _ingesting = false;

/**
 * Resolves a raw model/provider pair to a canonical human-readable model ID.
 * UUID model IDs (e.g. nexos UUIDs) are resolved via the provider registry.
 * Falls back to provider/model namespacing or 'unknown'.
 */
function resolveModelId(
  rawModel: string | undefined,
  provider: string | undefined,
  providerModelMap: Map<string, ProviderModel>,
): string {
  const model = rawModel ?? '';
  if (!model) return 'unknown';

  // Build the candidate key: prefix with provider if not already namespaced
  const candidate =
    provider && !model.includes('/') ? `${provider}/${model}` : model;

  // Resolve UUID keys via provider registry
  const entry = providerModelMap.get(candidate) ?? providerModelMap.get(model);
  if (entry) return `${entry.provider}/${entry.name}`;

  return candidate || 'unknown';
}

/**
 * Ingests new lines from a single JSONL file into cron_runs.
 * Reads only bytes beyond the stored last_offset.
 */
function ingestFile(
  filePath: string,
  cronId: string,
  agentId: string,
  payloadModel: string | undefined,
  providerModelMap: Map<string, ProviderModel>,
): void {
  const db = getDb();

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return; // file doesn't exist yet
  }

  const stateRow = db
    .prepare('SELECT last_offset FROM ingestion_state WHERE file_path = ?')
    .get(filePath) as { last_offset: number } | undefined;

  const lastOffset = stateRow?.last_offset ?? 0;

  // Skip if nothing new
  if (stat.size <= lastOffset) return;

  // Read only new bytes
  const newByteCount = stat.size - lastOffset;
  const buf = Buffer.alloc(newByteCount);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, newByteCount, lastOffset);
  } finally {
    fs.closeSync(fd);
  }

  const text = buf.toString('utf8');
  const parts = text.split('\n');

  // Discard last element if file didn't end with '\n' (partial write in progress)
  const safeLines = text.endsWith('\n') ? parts.filter((l) => l.trim()) : parts.slice(0, -1).filter((l) => l.trim());

  if (safeLines.length === 0) return;

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO cron_runs
      (id, cron_id, agent_id, status, started_at, finished_at, duration_ms,
       output_excerpt, drive_url, error_message,
       model, provider, input_tokens, output_tokens, total_tokens, run_at_ms)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateState = db.prepare(`
    INSERT OR REPLACE INTO ingestion_state (file_path, last_offset, updated_at)
    VALUES (?, ?, datetime('now'))
  `);

  db.transaction(() => {
    for (const line of safeLines) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      const id =
        typeof obj['sessionId'] === 'string' ? obj['sessionId'] :
        typeof obj['id'] === 'string' ? obj['id'] :
        crypto.randomUUID();

      const rawStatus = typeof obj['status'] === 'string' ? obj['status'] : 'failure';
      const status =
        rawStatus === 'ok' ? 'success' :
        rawStatus === 'success' || rawStatus === 'running' ? rawStatus : 'failure';

      const runAtMs = typeof obj['runAtMs'] === 'number' ? obj['runAtMs'] : null;
      const durationMs =
        typeof obj['durationMs'] === 'number' ? obj['durationMs'] :
        typeof obj['duration_ms'] === 'number' ? obj['duration_ms'] : null;

      const startedAt =
        runAtMs != null ? new Date(runAtMs).toISOString() :
        typeof obj['startedAt'] === 'string' ? obj['startedAt'] :
        typeof obj['started_at'] === 'string' ? obj['started_at'] :
        new Date().toISOString();

      const finishedAt =
        runAtMs != null && durationMs != null ? new Date(runAtMs + durationMs).toISOString() :
        typeof obj['finishedAt'] === 'string' ? obj['finishedAt'] :
        typeof obj['finished_at'] === 'string' ? obj['finished_at'] : null;

      const outputExcerpt =
        typeof obj['summary'] === 'string' ? obj['summary'] :
        typeof obj['outputExcerpt'] === 'string' ? obj['outputExcerpt'] :
        typeof obj['output_excerpt'] === 'string' ? obj['output_excerpt'] : null;

      const driveUrl = typeof obj['driveUrl'] === 'string' ? obj['driveUrl'] : null;

      const errorMessage =
        typeof obj['errorMessage'] === 'string' ? obj['errorMessage'] :
        typeof obj['error'] === 'string' ? obj['error'] : null;

      const rawModel = typeof obj['model'] === 'string' ? obj['model'] : undefined;
      const rawProvider = typeof obj['provider'] === 'string' ? obj['provider'] : undefined;
      const modelId = resolveModelId(rawModel, rawProvider, providerModelMap)
        || (payloadModel ?? 'unknown');

      const rawUsage =
        typeof obj['usage'] === 'object' && obj['usage'] !== null
          ? (obj['usage'] as Record<string, unknown>)
          : null;

      const inputTokens =
        rawUsage && typeof rawUsage['input_tokens'] === 'number' ? rawUsage['input_tokens'] : null;
      const outputTokens =
        rawUsage && typeof rawUsage['output_tokens'] === 'number' ? rawUsage['output_tokens'] : null;
      const totalTokens =
        rawUsage && typeof rawUsage['total_tokens'] === 'number' ? rawUsage['total_tokens'] : null;

      upsert.run(
        id, cronId, agentId, status, startedAt, finishedAt, durationMs,
        outputExcerpt, driveUrl, errorMessage,
        modelId, rawProvider ?? null, inputTokens, outputTokens, totalTokens,
        runAtMs,
      );
    }

    updateState.run(filePath, stat.size);
  })();
}

/**
 * Ingests all cron run JSONL files into mc.db.
 * Safe to call synchronously at startup or from a background interval.
 */
export function ingestCronRuns(): void {
  if (_ingesting) return;
  _ingesting = true;

  try {
    const clawDir = process.env['OPENCLAW_DIR'] ?? '/openclaw';
    const jobs = readCronJobsFile();
    if (jobs.length === 0) return;

    const { providerModels } = readOpenClawConfig();

    // Build UUID → ProviderModel lookup map
    const providerModelMap = new Map<string, ProviderModel>();
    for (const pm of providerModels) {
      if (UUID_RE.test(pm.id)) {
        providerModelMap.set(`${pm.provider}/${pm.id}`, pm);
        providerModelMap.set(pm.id, pm);
      }
    }

    for (const job of jobs) {
      const filePath = path.join(clawDir, 'cron', 'runs', `${job.id}.jsonl`);
      try {
        ingestFile(filePath, job.id, job.agentId, job.payload?.model, providerModelMap);
      } catch (err) {
        console.error(`[ingest] failed to ingest ${job.id}:`, err);
      }
    }
  } finally {
    _ingesting = false;
  }
}

/**
 * Starts the recurring background ingestion interval (every 5 minutes).
 * The first pass should already have run synchronously inside getDb().
 */
export function startIngestion(): void {
  if (process.env['USE_FIXTURES'] === 'true') return;

  setInterval(() => {
    try {
      ingestCronRuns();
    } catch (err) {
      console.error('[ingest] background pass failed:', err);
    }
  }, 5 * 60 * 1000);
}
