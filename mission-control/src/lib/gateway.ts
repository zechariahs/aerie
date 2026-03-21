// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Gateway API client for cron operations.
 *
 * Architectural decision (session-3): The OpenClaw Gateway is a WebSocket-only
 * service at OPENCLAW_GATEWAY_URL. There are no public REST API docs at time of
 * writing. This module implements WebSocket RPC in a best-effort format (JSON
 * envelope with a correlation ID), with a graceful error fallback when the
 * Gateway is unreachable.
 *
 * If USE_FIXTURES=true, all functions return synthetic success responses
 * without touching the network — safe for local dev without a live Gateway.
 *
 * TODO(session-7): Once the full WebSocket bridge is built, integrate
 * getCronRuns to receive streamed run events from the Gateway and persist them
 * to cron_runs in mc.db rather than relying on manual ingest.
 */

import WebSocket from 'ws';
import type { CronRun } from '@/types';
import { getDb } from './db';
import path from 'path';
import fs from 'fs';

const WS_TIMEOUT_MS = 8000;

interface GatewayRpcRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface GatewayRpcResponse {
  id: string;
  result?: Record<string, unknown>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function gatewayUrl(): string {
  return process.env['OPENCLAW_GATEWAY_URL'] ?? 'ws://localhost:18789';
}

function gatewayToken(): string {
  return process.env['OPENCLAW_GATEWAY_TOKEN'] ?? '';
}

/**
 * Opens a short-lived WebSocket connection to the Gateway, sends a single RPC
 * request, waits for the matching response, then closes the socket.
 * REQUIRES_GATEWAY — throws if Gateway is unreachable within WS_TIMEOUT_MS.
 */
async function rpcCall(method: string, params: Record<string, unknown>): Promise<GatewayRpcResponse> {
  return new Promise((resolve, reject) => {
    const correlationId = crypto.randomUUID();
    const ws = new WebSocket(gatewayUrl(), {
      headers: { Authorization: `Bearer ${gatewayToken()}` },
    });

    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Gateway RPC timeout'));
    }, WS_TIMEOUT_MS);

    ws.on('open', () => {
      const req: GatewayRpcRequest = { id: correlationId, method, params };
      ws.send(JSON.stringify(req));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as GatewayRpcResponse;
        if (msg.id === correlationId) {
          clearTimeout(timer);
          ws.close();
          resolve(msg);
        }
      } catch {
        // Ignore non-JSON messages (e.g. heartbeat pings)
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on('close', (code) => {
      if (code !== 1000) {
        clearTimeout(timer);
        reject(new Error(`Gateway closed unexpectedly: ${code}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends a trigger request to the Gateway to run a cron job immediately.
 * REQUIRES_GATEWAY — returns { ok: false, error } if Gateway is unavailable.
 */
export async function triggerCron(cronId: string): Promise<{ ok: boolean; error?: string }> {
  if (process.env['USE_FIXTURES'] === 'true') {
    return { ok: true };
  }

  try {
    const res = await rpcCall('cron.run', { cronId });
    if (res.error) return { ok: false, error: res.error };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Gateway unavailable: ${message}` };
  }
}

/**
 * Sends an enable or disable request for a cron job to the Gateway.
 * REQUIRES_GATEWAY — returns { ok: false, error } if Gateway is unavailable.
 */
export async function setCronEnabled(cronId: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  if (process.env['USE_FIXTURES'] === 'true') {
    return { ok: true };
  }

  try {
    const res = await rpcCall('cron.setEnabled', { cronId, enabled });
    if (res.error) return { ok: false, error: res.error };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Gateway unavailable: ${message}` };
  }
}

/**
 * Sends a schedule update request to the Gateway.
 * REQUIRES_GATEWAY — returns { ok: false, error } if Gateway is unavailable.
 */
export async function updateCronSchedule(cronId: string, schedule: string): Promise<{ ok: boolean; error?: string }> {
  if (process.env['USE_FIXTURES'] === 'true') {
    return { ok: true };
  }

  try {
    const res = await rpcCall('cron.setSchedule', { cronId, schedule });
    if (res.error) return { ok: false, error: res.error };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Gateway unavailable: ${message}` };
  }
}

/**
 * Returns stored cron run history from mc.db for the given cron job.
 * Falls back to fixture data in dev mode.
 * Run records are populated by the Gateway event bridge (session-7).
 * Returns empty array until the bridge is wired up.
 */
export function getCronRuns(cronId: string, limit: number): CronRun[] {
  if (process.env['USE_FIXTURES'] === 'true') {
    return loadRunFixtures(cronId, limit);
  }

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, cron_id, status, started_at, finished_at,
              duration_ms, output_excerpt, drive_url, error_message
       FROM cron_runs
       WHERE cron_id = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(cronId, limit) as Array<{
    id: string;
    cron_id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    duration_ms: number | null;
    output_excerpt: string | null;
    drive_url: string | null;
    error_message: string | null;
  }>;

  return rows.map((row): CronRun => ({
    id: row.id,
    cronId: row.cron_id,
    status: row.status as CronRun['status'],
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    outputExcerpt: row.output_excerpt ?? undefined,
    driveUrl: row.drive_url ?? undefined,
    errorMessage: row.error_message ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface CronFixtureFile {
  runs: Record<string, CronRun[]>;
}

function loadRunFixtures(cronId: string, limit: number): CronRun[] {
  try {
    const fixturePath = path.join(process.cwd(), 'fixtures', 'crons.json');
    const raw = fs.readFileSync(fixturePath, 'utf-8');
    const parsed = JSON.parse(raw) as CronFixtureFile;
    const runs = parsed.runs[cronId] ?? [];
    return runs.slice(0, limit);
  } catch {
    return [];
  }
}
