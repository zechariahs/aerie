// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';

interface AuditRow {
  id: number;
  timestamp: string;
  action: string;
  resource: string;
  result: string;
  ip: string;
  user_agent: string;
}

/**
 * GET /api/security/audit?page=1&limit=50
 *
 * Returns a paginated list of audit log entries. Read-only; no write operations.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);

  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)));

  if (!Number.isFinite(page) || !Number.isFinite(limit)) {
    return errorResponse('Invalid pagination parameters', 400);
  }

  const offset = (page - 1) * limit;

  try {
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT id, timestamp, action, resource, result, ip, user_agent
         FROM audit_log
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as AuditRow[];

    const totalRow = db
      .prepare('SELECT COUNT(*) AS total FROM audit_log')
      .get() as { total: number };

    return successResponse({
      entries: rows,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit),
      },
    });
  } catch (err) {
    console.error('[security/audit] db error', err);
    return errorResponse('Failed to read audit log', 500);
  }
}
