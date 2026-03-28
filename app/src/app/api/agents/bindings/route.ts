// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/agents/bindings?agentId=<id>
 *
 * Runs `openclaw agents bindings [--agent <id>] --json`.
 * agentId is optional — omit to get all bindings.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { AgentBinding } from '@/types';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

async function runJsonCommand(args: string[]): Promise<{ data: unknown; stderr?: string }> {
  try {
    const { stdout } = await execFileAsync('openclaw', args, { timeout: 15_000 });
    const parsed = JSON.parse(stdout.trim()) as unknown;
    return { data: parsed };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (e.code === 'ENOENT') return { data: null, stderr: 'openclaw CLI not found' };
    if (e.stdout) {
      try { return { data: JSON.parse(e.stdout.trim()) as unknown }; } catch { /* fall through */ }
    }
    return { data: null, stderr: e.stderr ?? String(err) };
  }
}

function extractBindings(data: unknown): AgentBinding[] {
  if (Array.isArray(data)) return data as AgentBinding[];
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj['bindings'])) return obj['bindings'] as AgentBinding[];
    if (Array.isArray(obj['list'])) return obj['list'] as AgentBinding[];
  }
  return [];
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (process.env['USE_FIXTURES'] === 'true') {
    const fixture: AgentBinding[] = [
      { channel: 'telegram', accountId: 'default', agentId: 'main' },
    ];
    return successResponse(fixture);
  }

  const args = ['agents', 'bindings', '--json'];
  if (agentId) args.push('--agent', agentId);

  const { data, stderr } = await runJsonCommand(args);
  if (!data) return errorResponse(stderr ?? 'Failed to get bindings', 502);

  return successResponse(extractBindings(data));
}
