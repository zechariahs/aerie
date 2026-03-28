// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/agents/sessions/cleanup?agentId=<id>
 *
 * Runs `openclaw sessions cleanup --agent <id> --dry-run --json`.
 * Returns a list of what would be pruned vs kept. Read-only — no enforce.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

interface CleanupItem {
  action: 'prune' | 'keep';
  key: string;
  age?: string;
  flags?: string;
}

function extractCleanupItems(data: unknown): CleanupItem[] {
  if (Array.isArray(data)) return data as CleanupItem[];
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj['items'])) return obj['items'] as CleanupItem[];
    if (Array.isArray(obj['actions'])) return obj['actions'] as CleanupItem[];
    if (Array.isArray(obj['results'])) return obj['results'] as CleanupItem[];
  }
  return [];
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId) return errorResponse('agentId is required', 400);

  if (process.env['USE_FIXTURES'] === 'true') {
    return successResponse({
      items: [
        { action: 'prune', key: `agent:${agentId}:telegram:direct:1619919639`, age: '45d' },
        { action: 'keep', key: `agent:${agentId}:main`, age: '2h', flags: 'active' },
      ] satisfies CleanupItem[],
    });
  }

  try {
    const { stdout } = await execFileAsync(
      'openclaw',
      ['sessions', 'cleanup', '--agent', agentId, '--dry-run', '--json'],
      { timeout: 15_000 },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      // Non-JSON output — return as raw text
      return successResponse({ items: [], raw: stdout.trim() });
    }
    return successResponse({ items: extractCleanupItems(parsed), raw: null });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (e.code === 'ENOENT') return errorResponse('openclaw CLI not found', 502);
    const msg = e.stderr?.trim() || String(err);
    return errorResponse(msg, 502);
  }
}
