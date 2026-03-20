// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, validateTotpFromRequest } from '@/lib/auth';
import { loadPriceTable, savePriceTable } from '@/lib/cost';
import { errorResponse, successResponse } from '@/lib/api-response';
import { writeAuditLog } from '@/lib/db';
import type { ModelPrice } from '@/types';

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  return successResponse(loadPriceTable());
}

export async function PUT(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  // Every write route requires a valid TOTP token
  if (!validateTotpFromRequest(request)) {
    writeAuditLog({
      action: 'price-table.update',
      resource: '/api/costs/price-table',
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? '',
    });
    return errorResponse('TOTP required', 403, 'TOTP_REQUIRED');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!Array.isArray(body)) {
    return errorResponse('Body must be an array of ModelPrice entries', 400);
  }

  const table = (body as unknown[]).filter(isModelPrice);
  if (table.length === 0) {
    return errorResponse('No valid ModelPrice entries found in body', 400);
  }

  savePriceTable(table);

  writeAuditLog({
    action: 'price-table.update',
    resource: '/api/costs/price-table',
    result: 'success',
    ip: request.headers.get('x-forwarded-for') ?? 'unknown',
    userAgent: request.headers.get('user-agent') ?? '',
  });

  return successResponse(table);
}

function isModelPrice(v: unknown): v is ModelPrice {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj['modelId'] === 'string' &&
    typeof obj['inputPer1MTokens'] === 'number' &&
    typeof obj['outputPer1MTokens'] === 'number'
  );
}
