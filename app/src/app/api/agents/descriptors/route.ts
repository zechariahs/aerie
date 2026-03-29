// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/agents/descriptors
 *
 * Returns agent id+name pairs from openclaw.json — no CLI invocation.
 * Used by the status strip to resolve agent IDs to display names.
 */

import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';
import { getAgents } from '@/lib/openclaw';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const agents = getAgents();
  return successResponse(agents.map((a) => ({ id: a.id, name: a.name })));
}
