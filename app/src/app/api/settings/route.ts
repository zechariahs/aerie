// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, isAgentRequest, validateTotpFromRequest } from '@/lib/auth';
import { getDb, writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';

interface SettingsRow {
  key: string;
  value: string;
  updated_at: string;
}

function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as SettingsRow[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

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
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (!validateTotpFromRequest(request)) {
    writeAuditLog({
      action: 'settings.update',
      resource: 'settings',
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse('TOTP required', 403);
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

  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  );

  for (const [key, value] of Object.entries(body)) {
    if (typeof key !== 'string' || typeof value !== 'string') continue;
    upsert.run(key, value);
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';
  writeAuditLog({ action: 'settings.update', resource: 'settings', result: 'success', ip, userAgent });

  return successResponse(getAllSettings());
}
