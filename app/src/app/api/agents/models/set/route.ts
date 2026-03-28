// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * POST /api/agents/models/set
 * Body: { agentId: string; modelRef: string }
 *
 * Runs `openclaw models set <modelRef> --agent <agentId>`.
 * modelRef must contain at least one '/' (e.g. openrouter/moonshotai/kimi-k2-0905).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

interface SetModelBody {
  agentId: string;
  modelRef: string;
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  let body: SetModelBody;
  try {
    body = (await request.json()) as SetModelBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { agentId, modelRef } = body;

  if (!agentId || typeof agentId !== 'string') {
    return errorResponse('agentId is required', 400);
  }
  if (!modelRef || typeof modelRef !== 'string') {
    return errorResponse('modelRef is required', 400);
  }
  // Must contain at least one '/' (provider/model format)
  if (!modelRef.includes('/')) {
    return errorResponse('modelRef must be in provider/model format (e.g. openrouter/kimi-k2)', 400);
  }

  if (process.env['USE_FIXTURES'] === 'true') {
    return successResponse({ ok: true });
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      'openclaw',
      ['models', 'set', modelRef, '--agent', agentId],
      { timeout: 15_000 },
    );
    return successResponse({ ok: true, output: (stdout + stderr).trim() || null });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (e.code === 'ENOENT') return errorResponse('openclaw CLI not found', 502);
    // Return openclaw's error verbatim (it's descriptive per spec §10.2)
    const msg = (e.stderr ?? e.stdout ?? '').trim() || String(err);
    return errorResponse(msg, 422);
  }
}
