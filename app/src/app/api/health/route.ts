// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/** Used by Docker healthcheck — no auth required. */

import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';
import { gatewayStatus } from '@/lib/gateway-bridge';

const startTime = Date.now();

export async function GET(): Promise<Response> {
  const errors: string[] = [];

  // db
  let dbStatus: 'ok' | 'error' = 'ok';
  try {
    getDb();
  } catch (err) {
    dbStatus = 'error';
    errors.push(`db: ${String(err)}`);
  }

  // openclawMount
  const openclawDir = process.env['OPENCLAW_DIR'] ?? '/openclaw';
  const jobsJson = path.join(openclawDir, 'cron', 'jobs.json');
  let openclawMount: 'ok' | 'missing' | 'partial' = 'ok';
  try {
    fs.accessSync(jobsJson, fs.constants.R_OK);
  } catch {
    openclawMount = 'missing';
    errors.push(`openclawMount: ${jobsJson} not readable`);
  }

  // gatewayConnected — read from singleton
  const gatewayConnected = gatewayStatus === 'connected';

  // hostAgentReachable — non-blocking, 1s timeout
  let hostAgentReachable = false;
  try {
    const hostUrl = process.env['HOST_AGENT_URL'] ?? 'http://host.docker.internal:3101';
    const token = process.env['HOST_AGENT_TOKEN'] ?? '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try {
      const res = await fetch(`${hostUrl}/metrics`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      hostAgentReachable = res.status === 200;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // unreachable or timeout — leave false
  }

  // driveConfigured — validate b64 JSON locally, no network
  let driveConfigured = false;
  const b64 = process.env['GOOGLE_SERVICE_ACCOUNT_JSON_B64'] ?? '';
  if (b64) {
    try {
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded) as Record<string, unknown>;
      driveConfigured = parsed['type'] === 'service_account';
    } catch {
      // malformed — leave false
    }
  }

  // fixtureMode
  const fixtureMode = process.env['USE_FIXTURES'] === 'true';

  const ok = dbStatus === 'ok' && openclawMount !== 'missing';

  return Response.json(
    {
      ok,
      version: '1.0',
      uptime: Math.floor(process.uptime()),
      checks: {
        db: dbStatus,
        openclawMount,
        gatewayConnected,
        hostAgentReachable,
        driveConfigured,
        fixtureMode,
      },
      errors,
    },
    { status: ok ? 200 : 503 }
  );
}
