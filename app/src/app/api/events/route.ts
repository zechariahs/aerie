// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/events
 *
 * Server-Sent Events stream. Each connected browser client receives
 * ActivityEvent objects as they arrive from the Gateway bridge.
 *
 * Heartbeat ping every 30s to keep connections alive through proxies.
 * Auth: requires valid session cookie (read-only — no TOTP needed).
 *
 * REQUIRES_GATEWAY — in fixture mode, events are streamed from
 * fixtures/activity-events.json every 3s by the bridge.
 */

import { getSession } from '@/lib/auth';
import { ensureBridgeStarted, activityBus } from '@/lib/gateway-bridge';
import type { ActivityEvent } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  ensureBridgeStarted();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(data: string): void {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Client disconnected — cleanup handled in cancel()
        }
      }

      function onEvent(event: ActivityEvent): void {
        send(`data: ${JSON.stringify(event)}\n\n`);
      }

      // Heartbeat ping every 30s to keep connection alive through proxies
      const heartbeat = setInterval(() => {
        send(': ping\n\n');
      }, 30_000);

      activityBus.on('event', onEvent);

      // Cleanup when client disconnects
      // ReadableStream cancel is called on client disconnect
      void (controller as unknown as { cancel?: () => void });

      // Store cleanup on the controller so cancel() can reach it
      (controller as unknown as Record<string, unknown>)['_cleanup'] = () => {
        clearInterval(heartbeat);
        activityBus.off('event', onEvent);
      };
    },
    cancel(controller) {
      const cleanup = (controller as unknown as Record<string, unknown>)['_cleanup'];
      if (typeof cleanup === 'function') {
        (cleanup as () => void)();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable Nginx buffering for SSE
    },
  });
}
