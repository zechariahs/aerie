// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/gateway/ws
 *
 * Initializes the singleton Gateway WebSocket bridge and returns a 200
 * confirmation. This route exists so the bridge can be eagerly started
 * by the dashboard layout without needing an SSE connection first.
 *
 * The actual event stream is served by /api/events (SSE).
 * The Gateway connection status is served by /api/gateway/status.
 *
 * REQUIRES_GATEWAY — in fixture mode, the bridge streams synthetic events.
 */

import { getSession } from '@/lib/auth';
import { errorResponse, successResponse } from '@/lib/api-response';
import { ensureBridgeStarted, gatewayStatus } from '@/lib/gateway-bridge';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  ensureBridgeStarted();

  return successResponse({ status: gatewayStatus });
}
