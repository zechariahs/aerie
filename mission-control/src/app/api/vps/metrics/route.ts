// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import path from 'path';
import fs from 'fs';
import { getSession } from '@/lib/auth';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { VpsMetrics } from '@/types/index';

const HOST_AGENT_URL = process.env['HOST_AGENT_URL'] ?? 'http://127.0.0.1:3101';
const HOST_AGENT_TOKEN = process.env['HOST_AGENT_TOKEN'];
const USE_FIXTURES = process.env['USE_FIXTURES'] === 'true';

/** Load fixture VpsMetrics for local dev when USE_FIXTURES=true. */
function loadFixture(): VpsMetrics {
  const fixturePath = path.resolve(process.cwd(), 'fixtures', 'vps-metrics.json');
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(raw) as { metrics: VpsMetrics };
  return parsed.metrics;
}

/** Normalize the host agent's snake_case /metrics response into VpsMetrics. */
function normalizeMetrics(raw: unknown): VpsMetrics {
  const r = raw as Record<string, unknown>;
  const memory = r['memory'] as Record<string, unknown>;
  const disk = r['disk'] as Record<string, unknown>;
  const network = r['network'] as Record<string, unknown>;
  const loadavg = r['loadavg'] as [number, number, number];

  const diskUsedBytes = Number(disk['used_bytes'] ?? 0);
  const diskTotalBytes = Number(disk['total_bytes'] ?? 0);

  return {
    cpuPct: Number(r['cpu_pct'] ?? 0),
    memUsedMb: Number(memory['used_mb'] ?? 0),
    memTotalMb: Number(memory['total_mb'] ?? 0),
    diskUsedGb: Math.round((diskUsedBytes / 1e9) * 10) / 10,
    diskTotalGb: Math.round((diskTotalBytes / 1e9) * 10) / 10,
    networkInBps: Number(network['in_bps'] ?? 0),
    networkOutBps: Number(network['out_bps'] ?? 0),
    loadAvg1m: loadavg?.[0] ?? 0,
    loadAvg5m: loadavg?.[1] ?? 0,
    loadAvg15m: loadavg?.[2] ?? 0,
    uptimeSeconds: Number(r['uptime_seconds'] ?? 0),
    sampledAt: Number(r['sampled_at'] ?? Date.now()),
  };
}

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (USE_FIXTURES) {
    return successResponse<VpsMetrics>(loadFixture());
  }

  try {
    const headers: Record<string, string> = {};
    if (HOST_AGENT_TOKEN) headers['Authorization'] = `Bearer ${HOST_AGENT_TOKEN}`;

    const res = await fetch(`${HOST_AGENT_URL}/metrics`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return errorResponse('Host agent returned an error', 503, 'HOST_AGENT_ERROR');
    }
    const data = await res.json() as unknown;
    return successResponse<VpsMetrics>(normalizeMetrics(data));
  } catch {
    return errorResponse('Host agent unavailable', 503, 'HOST_AGENT_UNAVAILABLE');
  }
}
