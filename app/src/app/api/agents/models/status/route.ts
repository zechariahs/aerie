// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/agents/models/status?agentId=<id>
 *
 * Runs `openclaw models status --agent <id> --json` and returns the parsed result.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';
import { getOpenclawExec } from '@/lib/openclaw-exec';
import type { AgentModelsStatus } from '@/types';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

function normalizeModelsStatus(data: unknown): AgentModelsStatus {
  if (typeof data !== 'object' || data === null) return {};

  const obj = data as Record<string, unknown>;

  // Normalize primary model — may be under obj.primary, obj.model.primary, etc.
  let primary: string | undefined;
  if (typeof obj['primary'] === 'string') {
    primary = obj['primary'];
  } else if (typeof obj['model'] === 'object' && obj['model'] !== null) {
    const m = obj['model'] as Record<string, unknown>;
    if (typeof m['primary'] === 'string') primary = m['primary'];
  }

  // Fallbacks
  const fallbacks = Array.isArray(obj['fallbacks'])
    ? (obj['fallbacks'] as string[])
    : undefined;

  // Allowlist — may be array of strings or objects
  let allowlist: AgentModelsStatus['allowlist'] = undefined;
  if (Array.isArray(obj['allowlist'])) {
    allowlist = (obj['allowlist'] as unknown[]).map((item) => {
      if (typeof item === 'string') return { ref: item };
      const i = item as Record<string, unknown>;
      return { ref: String(i['ref'] ?? i['id'] ?? item), alias: typeof i['alias'] === 'string' ? i['alias'] : undefined };
    });
  }

  // Auth
  let auth: AgentModelsStatus['auth'] = undefined;
  if (Array.isArray(obj['auth'])) {
    auth = (obj['auth'] as unknown[]).map((a) => {
      const row = a as Record<string, unknown>;
      return { provider: String(row['provider'] ?? ''), status: String(row['status'] ?? 'unknown') };
    });
  }

  // Image models
  const imageModel = typeof obj['imageModel'] === 'string' ? obj['imageModel'] : undefined;
  const imageGenerationModel = typeof obj['imageGenerationModel'] === 'string'
    ? obj['imageGenerationModel']
    : undefined;

  return { primary, fallbacks, allowlist, auth, imageModel, imageGenerationModel };
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId) return errorResponse('agentId is required', 400);

  if (process.env['USE_FIXTURES'] === 'true') {
    const fixture: AgentModelsStatus = {
      primary: 'openrouter/moonshotai/kimi-k2-0905',
      fallbacks: ['anthropic/claude-haiku-4-5-20251001'],
      allowlist: [
        { ref: 'moonshotai/kimi-k2-0905', alias: undefined },
        { ref: 'openrouter/moonshotai/kimi-k2-0905', alias: undefined },
        { ref: 'claude-haiku-4-5-20251001', alias: 'heartbeat' },
      ],
      auth: [
        { provider: 'openrouter', status: 'ok' },
        { provider: 'anthropic', status: 'ok' },
      ],
    };
    return successResponse(fixture);
  }

  try {
    const { bin, args } = getOpenclawExec(['models', 'status', '--agent', agentId, '--json']);
    const { stdout } = await execFileAsync(bin, args, { timeout: 15_000 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      return errorResponse('Unexpected non-JSON output from models status', 502);
    }
    return successResponse(normalizeModelsStatus(parsed));
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (e.code === 'ENOENT') return errorResponse('openclaw CLI not found', 502);
    // Try stdout
    if (e.stdout) {
      try {
        const parsed = JSON.parse(e.stdout.trim()) as unknown;
        return successResponse(normalizeModelsStatus(parsed));
      } catch { /* fall through */ }
    }
    const msg = e.stderr?.trim() || String(err);
    return errorResponse(msg, 502);
  }
}
