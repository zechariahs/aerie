// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/events
 *
 * Server-Sent Events stream. Proxies the host agent SSE stream directly to
 * connected browser clients. No buffering, no transformation.
 *
 * Auth: requires valid session cookie (no TOTP).
 */

import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const hostAgentUrl = `http://host.docker.internal:3101/events`;
  const token = process.env['HOST_AGENT_TOKEN'] ?? '';

  let upstream: Response;
  try {
    upstream = await fetch(hostAgentUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return new Response('Service Unavailable', { status: 503 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response('Bad Gateway', { status: 502 });
  }

  const encoder = new TextEncoder();
  const upstreamBody = upstream.body;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstreamBody.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch {
        // upstream closed or client disconnected
      } finally {
        try {
          controller.enqueue(encoder.encode('data: {"type":"disconnect"}\n\n'));
        } catch {
          // controller already closed
        }
        controller.close();
      }
    },
    cancel() {
      // Browser client disconnected — the fetch abort propagates to upstream reader
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
