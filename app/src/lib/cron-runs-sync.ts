// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Cron-runs sync — server-side consumer of the host agent SSE stream.
 *
 * Responsibilities:
 *   1. backfillCronRuns()        — called after gateway auth; triggers ingestAll()
 *                                  to populate SQLite from on-disk JSONL files.
 *   2. startHostAgentConsumer()  — singleton SSE connection to the host agent that
 *                                  triggers targeted ingestCronRuns() whenever a
 *                                  cron_run envelope arrives.
 *
 * Uses the globalThis singleton pattern (same as gateway-bridge) so all Next.js
 * bundle instances share state.
 */

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

type SyncGlobals = {
  consumerStarted: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __cronRunsSync: SyncGlobals | undefined;
}

function getG(): SyncGlobals {
  if (!globalThis.__cronRunsSync) {
    globalThis.__cronRunsSync = { consumerStarted: false };
  }
  return globalThis.__cronRunsSync;
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

/**
 * Triggers a full incremental ingest pass (JSONL → SQLite) for all cron runs
 * and agent sessions. Safe to call multiple times — ingestAll() is idempotent
 * and tracks byte offsets.
 */
export function backfillCronRuns(): void {
  if (process.env['USE_FIXTURES'] === 'true') return;
  try {
    // Dynamic require keeps the import lazy so this module is safe to load
    // in instrumentation.ts before the db is fully ready.
    const { ingestAll } = require('./ingest') as typeof import('./ingest');
    ingestAll();
  } catch (err) {
    console.error('[cron-runs-sync] backfill failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Server-side SSE consumer
// ---------------------------------------------------------------------------

const RECONNECT_DELAY_MS = 15_000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Starts a singleton SSE connection to the host agent that triggers
 * SQLite ingestion whenever a cron_run envelope is received.
 * Safe to call multiple times — only one connection is maintained.
 */
export function startHostAgentConsumer(): void {
  if (process.env['USE_FIXTURES'] === 'true') return;
  const g = getG();
  if (g.consumerStarted) return;
  g.consumerStarted = true;
  connectConsumer();
}

function connectConsumer(): void {
  const url = 'http://host.docker.internal:3101/events';
  const token = process.env['HOST_AGENT_TOKEN'] ?? '';

  void (async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error('[cron-runs-sync] consumer: could not connect to host agent:', (err as Error).message);
      scheduleReconnect();
      return;
    }

    if (!res.ok || !res.body) {
      console.error('[cron-runs-sync] consumer: bad response from host agent:', res.status);
      scheduleReconnect();
      return;
    }

    console.log('[cron-runs-sync] consumer: connected to host agent SSE');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buf.split('\n');
        buf = lines.pop() ?? ''; // keep last (possibly incomplete) chunk

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json || json === '{"type":"disconnect"}') continue;

          let envelope: Record<string, unknown>;
          try {
            envelope = JSON.parse(json) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (envelope['source'] === 'cron_run') {
            handleCronRunEvent(envelope);
          }
        }
      }
    } catch (err) {
      console.error('[cron-runs-sync] consumer: stream error:', (err as Error).message);
    }

    console.warn('[cron-runs-sync] consumer: host agent SSE closed, will reconnect');
    scheduleReconnect();
  })();
}

function handleCronRunEvent(envelope: Record<string, unknown>): void {
  // agentId holds the jobId for cron events (per envelope spec)
  const jobId = typeof envelope['agentId'] === 'string' ? envelope['agentId'] : null;
  if (!jobId) return;

  try {
    // Re-ingest JSONL for this job — picks up any new lines since last pass
    const { ingestCronRuns } = require('./ingest') as typeof import('./ingest');
    ingestCronRuns();

    // Confirm the run landed in SQLite via the authoritative typed reader
    const { readCronRuns } = require('./openclaw') as typeof import('./openclaw');
    const [run] = readCronRuns(jobId, 1);
    void run; // result available; callers poll SQLite directly
  } catch (err) {
    console.error('[cron-runs-sync] failed to ingest cron run for job', jobId, ':', err);
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectConsumer();
  }, RECONNECT_DELAY_MS);
}
