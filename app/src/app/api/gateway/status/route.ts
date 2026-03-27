// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/gateway/status
 *
 * Returns the current Gateway connection state and per-agent live status.
 * Polled every 10s by the status strip.
 *
 * Response: GatewayStatusResponse
 *   { status, lastEventAt, agentStates: AgentState[] }
 */

import { getSession } from '@/lib/auth';
import { errorResponse, successResponse } from '@/lib/api-response';
import {
  ensureBridgeStarted,
  getGatewayStatus,
  getLastEventAt,
  getAgentStates,
} from '@/lib/gateway-bridge';
import type { GatewayStatusResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  // Ensure bridge is running — idempotent
  ensureBridgeStarted();

  const response: GatewayStatusResponse = {
    status: getGatewayStatus(),
    lastEventAt: getLastEventAt(),
    agentStates: Array.from(getAgentStates().values()),
  };

  return successResponse(response);
}
