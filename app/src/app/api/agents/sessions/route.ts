// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/agents/sessions?agentId=<id>&activeMinutes=<n>
 *
 * Returns all sessions for an agent, and active sessions if activeMinutes is set.
 * Runs:
 *   openclaw sessions --agent <id> --json
 *   openclaw sessions --active <n> --agent <id> --json  (if activeMinutes provided)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { AgentSession, AgentSessionsResult } from '@/types';

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

function extractSessions(data: unknown): AgentSession[] {
  if (Array.isArray(data)) return data as AgentSession[];
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj['sessions'])) return obj['sessions'] as AgentSession[];
    if (Array.isArray(obj['list'])) return obj['list'] as AgentSession[];
  }
  return [];
}

function deriveStorePath(agentId: string): string {
  return `~/.openclaw/agents/${agentId}/sessions/sessions.json`;
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');
  const activeMinutesStr = searchParams.get('activeMinutes');

  if (!agentId) return errorResponse('agentId is required', 400);

  if (process.env['USE_FIXTURES'] === 'true') {
    const fixture: AgentSessionsResult = {
      sessions: [
        { key: `agent:${agentId}:telegram:direct:1619919639`, model: 'openrouter/moonshotai/kimi-k2-0905', active: false },
        { key: `agent:${agentId}:main`, model: 'claude-haiku-4-5-20251001', active: true },
      ],
      activeSessions: [
        { key: `agent:${agentId}:main`, model: 'claude-haiku-4-5-20251001', active: true },
      ],
      storePath: deriveStorePath(agentId),
    };
    return successResponse(fixture);
  }

  // Fetch all sessions
  const { data: allData, stderr } = await runJsonCommand(['sessions', '--agent', agentId, '--json']);
  if (!allData) return errorResponse(stderr ?? 'Failed to list sessions', 502);

  const sessions = extractSessions(allData);

  // Optionally fetch active sessions
  let activeSessions: AgentSession[] = [];
  if (activeMinutesStr) {
    const { data: activeData } = await runJsonCommand([
      'sessions', '--active', activeMinutesStr, '--agent', agentId, '--json',
    ]);
    if (activeData) activeSessions = extractSessions(activeData);
  }

  const result: AgentSessionsResult = {
    sessions,
    activeSessions,
    storePath: deriveStorePath(agentId),
  };

  return successResponse(result);
}
