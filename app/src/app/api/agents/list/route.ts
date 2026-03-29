// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/agents/list
 *
 * Runs `openclaw agents list --json` and returns the parsed agent config array.
 * Handles multiple output shapes:
 *   - Top-level array [...] (most likely)
 *   - { list: [...] }
 *   - { agents: [...] } or { agents: { list: [...] } }
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';
import { getOpenclawExec } from '@/lib/openclaw-exec';
import type { AgentConfig } from '@/types';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

async function runJsonCommand(clawArgs: string[]): Promise<{ data: unknown; stderr?: string }> {
  try {
    const { bin, args } = getOpenclawExec(clawArgs);
    const { stdout } = await execFileAsync(bin, args, { timeout: 15_000 });
    const parsed = JSON.parse(stdout.trim()) as unknown;
    return { data: parsed };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (e.code === 'ENOENT') return { data: null, stderr: 'openclaw CLI not found' };
    // Non-zero exit may still have parseable JSON on stdout
    if (e.stdout) {
      try {
        const parsed = JSON.parse(e.stdout.trim()) as unknown;
        return { data: parsed };
      } catch { /* fall through */ }
    }
    return { data: null, stderr: e.stderr ?? String(err) };
  }
}

function extractAgentList(data: unknown): AgentConfig[] {
  if (Array.isArray(data)) return data as AgentConfig[];
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj['list'])) return obj['list'] as AgentConfig[];
    if (Array.isArray(obj['agents'])) return obj['agents'] as AgentConfig[];
    const agents = obj['agents'];
    if (typeof agents === 'object' && agents !== null) {
      const a = agents as Record<string, unknown>;
      if (Array.isArray(a['list'])) return a['list'] as AgentConfig[];
    }
  }
  return [];
}

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  if (process.env['USE_FIXTURES'] === 'true') {
    const fixture: AgentConfig[] = [
      {
        id: 'main',
        name: 'Wintermute',
        workspace: '/openclaw/workspace',
        agentDir: '/openclaw/agents/main/agent',
        default: true,
        model: 'openrouter/moonshotai/kimi-k2-0905',
        identity: { name: 'Wintermute', emoji: '🤖', theme: 'terminal' },
        sandbox: { mode: 'off' },
        tools: { allow: ['Read', 'Write', 'Bash'], deny: [] },
      },
    ];
    return successResponse(fixture);
  }

  const { data, stderr } = await runJsonCommand(['agents', 'list', '--json']);
  if (!data) return errorResponse(stderr ?? 'Failed to list agents', 502);

  const agents = extractAgentList(data);
  return successResponse(agents);
}
