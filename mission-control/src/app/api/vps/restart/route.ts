// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, validateTotpFromRequest } from '@/lib/auth';
import { errorResponse, successResponse } from '@/lib/api-response';
import { writeAuditLog } from '@/lib/db';
import type { NextRequest } from 'next/server';

const HOST_AGENT_URL = process.env['HOST_AGENT_URL'] ?? 'http://127.0.0.1:3101';
const HOST_AGENT_TOKEN = process.env['HOST_AGENT_TOKEN'];
const USE_FIXTURES = process.env['USE_FIXTURES'] === 'true';

export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  // TOTP required for all write operations
  if (!validateTotpFromRequest(request)) {
    return errorResponse('TOTP required', 403, 'TOTP_REQUIRED');
  }

  if (USE_FIXTURES) {
    // In fixture mode, simulate a successful restart without calling the host agent
    return successResponse({ ok: true, container: 'openclaw-1' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (typeof body !== 'object' || body === null) {
    return errorResponse('Invalid request body', 400);
  }

  const { container } = body as Record<string, unknown>;
  if (typeof container !== 'string' || container.length === 0) {
    return errorResponse('container is required', 400);
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (HOST_AGENT_TOKEN) headers['Authorization'] = `Bearer ${HOST_AGENT_TOKEN}`;

    const res = await fetch(`${HOST_AGENT_URL}/docker/restart`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ container }),
      signal: AbortSignal.timeout(35000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
      writeAuditLog({ action: 'vps.restart.failed', resource: container, result: 'failure', ip: 'server', userAgent: '' });
      return errorResponse(String(err['error'] ?? 'Restart failed'), 503, 'HOST_AGENT_ERROR');
    }

    writeAuditLog({ action: 'vps.restart.success', resource: container, result: 'success', ip: 'server', userAgent: '' });
    return successResponse({ ok: true, container });
  } catch {
    return errorResponse('Host agent unavailable', 503, 'HOST_AGENT_UNAVAILABLE');
  }
}
