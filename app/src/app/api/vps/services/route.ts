// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import path from 'path';
import fs from 'fs';
import { getSession } from '@/lib/auth';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { VpsServiceStatus } from '@/types/index';

const HOST_AGENT_URL = process.env['HOST_AGENT_URL'] ?? 'http://127.0.0.1:3101';
const HOST_AGENT_TOKEN = process.env['HOST_AGENT_TOKEN'];
const USE_FIXTURES = process.env['USE_FIXTURES'] === 'true';

function loadFixture(): VpsServiceStatus {
  const fixturePath = path.resolve(process.cwd(), 'fixtures', 'vps-metrics.json');
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(raw) as { services: VpsServiceStatus };
  return parsed.services;
}

/** Normalize the host agent's snake_case /services response. */
function normalizeServices(raw: unknown): VpsServiceStatus {
  const r = raw as Record<string, unknown>;
  return {
    nginx: String(r['nginx'] ?? 'unknown'),
    openclawGateway: Boolean(r['openclaw_gateway'] ?? false),
  };
}

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (USE_FIXTURES) {
    return successResponse<VpsServiceStatus>(loadFixture());
  }

  try {
    const headers: Record<string, string> = {};
    if (HOST_AGENT_TOKEN) headers['Authorization'] = `Bearer ${HOST_AGENT_TOKEN}`;

    const res = await fetch(`${HOST_AGENT_URL}/services`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return errorResponse('Host agent returned an error', 503, 'HOST_AGENT_ERROR');
    }
    const data = await res.json() as unknown;
    return successResponse<VpsServiceStatus>(normalizeServices(data));
  } catch {
    return errorResponse('Host agent unavailable', 503, 'HOST_AGENT_UNAVAILABLE');
  }
}
