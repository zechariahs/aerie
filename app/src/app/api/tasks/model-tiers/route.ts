// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, isAgentRequest, validateTotpFromRequest } from '@/lib/auth';
import { getDb, writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { ModelTiers } from '@/types';

interface ModelTierRow {
  tier: string;
  model_id: string;
}

function getAllTiers(): ModelTiers {
  const db = getDb();
  const rows = db.prepare('SELECT tier, model_id FROM model_tiers').all() as ModelTierRow[];
  const result: ModelTiers = { fast: undefined, default: undefined, reasoning: undefined };
  for (const row of rows) {
    if (row.tier === 'fast' || row.tier === 'default' || row.tier === 'reasoning') {
      result[row.tier] = row.model_id;
    }
  }
  return result;
}

/**
 * GET /api/tasks/model-tiers
 * Returns the current tier → model ID mapping.
 * Requires session OR agent API key.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session && !isAgentRequest(request)) return errorResponse('Unauthorized', 401);

  return successResponse(getAllTiers());
}

/**
 * PUT /api/tasks/model-tiers
 * Upserts tier → model ID mappings.
 * Requires session + valid X-TOTP-Token header (human-only — config change).
 */
export async function PUT(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (!validateTotpFromRequest(request)) {
    writeAuditLog({
      action: 'model_tiers.update',
      resource: 'model_tiers',
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse('TOTP required', 403);
  }

  let body: Partial<Record<'fast' | 'default' | 'reasoning', string>>;
  try {
    body = (await request.json()) as Partial<Record<'fast' | 'default' | 'reasoning', string>>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO model_tiers (tier, model_id) VALUES (?, ?)
     ON CONFLICT(tier) DO UPDATE SET model_id = excluded.model_id, updated_at = datetime('now')`,
  );

  const validTiers = ['fast', 'default', 'reasoning'] as const;
  for (const tier of validTiers) {
    const modelId = body[tier];
    if (typeof modelId === 'string' && modelId.trim() !== '') {
      upsert.run(tier, modelId.trim());
    }
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? 'unknown';
  writeAuditLog({ action: 'model_tiers.update', resource: 'model_tiers', result: 'success', ip, userAgent });

  return successResponse(getAllTiers());
}
