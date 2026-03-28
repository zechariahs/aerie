// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * POST /api/agents/set-identity
 * Body: { agentId: string; name?: string; emoji?: string }
 *
 * Runs `openclaw agents set-identity --agent <id> [--name <n>] [--emoji <e>]`.
 * At least one of name/emoji must be provided.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

interface SetIdentityBody {
  agentId: string;
  name?: string;
  emoji?: string;
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  let body: SetIdentityBody;
  try {
    body = (await request.json()) as SetIdentityBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { agentId, name, emoji } = body;

  if (!agentId || typeof agentId !== 'string') {
    return errorResponse('agentId is required', 400);
  }

  // Validate name/emoji if provided
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return errorResponse('name must be a non-empty string', 400);
    }
    if (name.length > 64) {
      return errorResponse('name must be 64 characters or fewer', 400);
    }
  }
  if (emoji !== undefined) {
    if (typeof emoji !== 'string' || emoji.trim().length === 0) {
      return errorResponse('emoji must be a non-empty string', 400);
    }
    if (emoji.length > 8) {
      return errorResponse('emoji must be 8 characters or fewer', 400);
    }
  }

  if (!name && !emoji) {
    return errorResponse('At least one of name or emoji is required', 400);
  }

  if (process.env['USE_FIXTURES'] === 'true') {
    return successResponse({ ok: true });
  }

  const args = ['agents', 'set-identity', '--agent', agentId];
  if (name) args.push('--name', name.trim());
  if (emoji) args.push('--emoji', emoji.trim());

  try {
    await execFileAsync('openclaw', args, { timeout: 10_000 });
    return successResponse({ ok: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') return errorResponse('openclaw CLI not found', 502);
    const msg = e.stderr?.trim() || String(err);
    return errorResponse(msg, 502);
  }
}
