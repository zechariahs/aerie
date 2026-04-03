// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { isAgentRequest, getSession, requireTotpAuth } from '@/lib/auth';
import { getDb, writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';
import { getAllSettings } from '@/lib/settings';

/**
 * GET /api/settings
 * Returns all settings as a key/value map.
 * Requires session OR agent API key.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session && !isAgentRequest(request)) return errorResponse('Unauthorized', 401);

  return successResponse(getAllSettings());
}

/**
 * PUT /api/settings
 * Upserts one or more settings keys.
 * Requires session + valid X-TOTP-Token header (human-only — config change).
 */
export async function PUT(request: Request): Promise<Response> {
  const auth = await requireTotpAuth(request);
  if (!auth.ok) {
    if (auth.status === 403) {
      writeAuditLog({
        action: 'settings.update',
        resource: 'settings',
        result: 'failure',
        ip: request.headers.get('x-forwarded-for') ?? 'unknown',
        userAgent: request.headers.get('user-agent') ?? 'unknown',
      });
    }
    return errorResponse(auth.status === 401 ? 'Unauthorized' : 'TOTP required', auth.status);
  }

  let body: Record<string, string>;
  try {
    body = (await request.json()) as Record<string, string>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (typeof body !== 'object' || Array.isArray(body) || body === null) {
    return errorResponse('Body must be a JSON object', 400);
  }

  const ALLOWED_KEYS = new Set([
    'AGENT_ACTIVE_START',
    'AGENT_ACTIVE_END',
    'AGENT_TIMEZONE',
    'SESSION_DURATION_HOURS',
    'DAILY_COST_ALERT_USD',
  ]);

  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  );
  const del = db.prepare(`DELETE FROM settings WHERE key = ?`);

  for (const [key, value] of Object.entries(body)) {
    if (typeof key !== 'string' || typeof value !== 'string') continue;
    if (!ALLOWED_KEYS.has(key)) continue;
    // Empty string clears the setting; otherwise upsert the new value.
    if (value === '') {
      del.run(key);
    } else {
      upsert.run(key, value);
    }
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';
  writeAuditLog({ action: 'settings.update', resource: 'settings', result: 'success', ip, userAgent });

  return successResponse(getAllSettings());
}
