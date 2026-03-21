// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';

const execFileAsync = promisify(execFile);

// Known cron IDs — used to validate the cronId param for the cron-runs command.
// These IDs are non-sensitive (random hex, not credentials) per CLAUDE.md.
const KNOWN_CRON_IDS = new Set([
  '51d8a322',
  '76114cf6',
  'bb9599ba',
  'aec5f855',
  '63530884',
  '19f6e1bd',
]);

interface TerminalCommand {
  /** Human-readable label shown in the UI dropdown */
  label: string;
  /** Binary to pass to execFile */
  bin: string;
  /** Arguments array — never interpolated from user input */
  args: string[];
}

/** Static whitelist of allowed commands. Whitelist is hardcoded, not configurable. */
const WHITELIST: Record<string, TerminalCommand> = {
  'df-h': { label: 'df -h', bin: 'df', args: ['-h'] },
  'free-m': { label: 'free -m', bin: 'free', args: ['-m'] },
  uptime: { label: 'uptime', bin: 'uptime', args: [] },
  'openclaw-cron-list': { label: 'openclaw cron list', bin: 'openclaw', args: ['cron', 'list'] },
  // openclaw-cron-runs is handled separately because it requires a validated cronId arg
};

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const cmd = searchParams.get('cmd');

  if (!cmd) {
    return errorResponse('Missing cmd parameter', 400);
  }

  // Special case: openclaw cron runs requires a validated cronId
  if (cmd === 'openclaw-cron-runs') {
    const cronId = searchParams.get('cronId');
    if (!cronId) {
      return errorResponse('Missing cronId parameter', 400);
    }
    // Validate cronId against the known list — prevents command injection via ID param
    if (!KNOWN_CRON_IDS.has(cronId)) {
      return errorResponse('Unknown cron ID', 400, 'UNKNOWN_CRON_ID');
    }
    return runCommand('openclaw', ['cron', 'runs', '--id', cronId]);
  }

  const command = WHITELIST[cmd];
  if (!command) {
    return errorResponse(`Unknown command key: ${cmd}`, 400, 'UNKNOWN_CMD');
  }

  return runCommand(command.bin, command.args);
}

async function runCommand(bin: string, args: string[]): Promise<Response> {
  try {
    // execFile with separate args array — never interpolates user input into a shell string
    const { stdout, stderr } = await execFileAsync(bin, args, { timeout: 10_000 });
    const output = stdout || stderr || '(no output)';
    return successResponse({ output: output.trimEnd() });
  } catch (err) {
    const error = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };

    if (error.code === 'ENOENT') {
      return successResponse({
        output: `Command not found: ${bin}\nThis command may not be available in this environment.`,
      });
    }

    if (error.code === 'ETIMEDOUT') {
      return successResponse({ output: `Command timed out after 10 seconds.` });
    }

    // Non-zero exit codes still return output so the UI can display it
    const output = (error.stdout ?? '') + (error.stderr ?? '') || `Error: ${String(err)}`;
    return successResponse({ output: output.trimEnd() });
  }
}
