// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/agents/workspace/files?workspacePath=<path>
 *
 * Returns metadata for the standard workspace file set at the given workspace path.
 * Includes existence, character count, and modification time for each standard file,
 * plus directory info for `memory/`.
 */

import fs from 'fs';
import path from 'path';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { AgentWorkspaceFileInfo } from '@/types';

export const dynamic = 'force-dynamic';

interface StandardFileSpec {
  name: string;
  isDirectory?: boolean;
}

const STANDARD_FILES: StandardFileSpec[] = [
  { name: 'AGENTS.md' },
  { name: 'SOUL.md' },
  { name: 'USER.md' },
  { name: 'HEARTBEAT.md' },
  { name: 'BOOT.md' },
  { name: 'TOOLS.md' },
  { name: 'IDENTITY.md' },
  { name: 'BOOTSTRAP.md' },
  { name: 'MEMORY.md' },
  { name: 'memory', isDirectory: true },
];

function getFileInfo(workspacePath: string, spec: StandardFileSpec): AgentWorkspaceFileInfo {
  const fullPath = path.join(workspacePath, spec.name);

  if (!fs.existsSync(fullPath)) {
    return { name: spec.name, exists: false, isDirectory: spec.isDirectory };
  }

  if (spec.isDirectory) {
    let files: string[] = [];
    let latestDate: string | undefined;
    try {
      files = fs.readdirSync(fullPath).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
      latestDate = files.length > 0 ? files[files.length - 1]!.replace('.md', '') : undefined;
    } catch { /* unreadable */ }
    return {
      name: spec.name,
      exists: true,
      isDirectory: true,
      fileCount: files.length,
      latestDate,
      files,
    };
  }

  try {
    const stat = fs.statSync(fullPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    return {
      name: spec.name,
      exists: true,
      sizeChars: content.length,
      modifiedAt: stat.mtime.toISOString(),
    };
  } catch {
    return { name: spec.name, exists: true };
  }
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const workspacePath = searchParams.get('workspacePath');

  if (!workspacePath) return errorResponse('workspacePath is required', 400);
  if (!path.isAbsolute(workspacePath)) return errorResponse('workspacePath must be absolute', 400);
  if (workspacePath.includes('..')) return errorResponse('Invalid workspacePath', 400);

  if (process.env['USE_FIXTURES'] === 'true') {
    const fixture: AgentWorkspaceFileInfo[] = STANDARD_FILES.map((spec) => ({
      name: spec.name,
      exists: ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'memory'].includes(spec.name),
      isDirectory: spec.isDirectory,
      sizeChars: spec.isDirectory ? undefined : 1200,
      modifiedAt: spec.isDirectory ? undefined : new Date(Date.now() - 3_600_000 * 3).toISOString(),
      fileCount: spec.name === 'memory' ? 14 : undefined,
      latestDate: spec.name === 'memory' ? '2026-03-26' : undefined,
    }));
    return successResponse(fixture);
  }

  if (!fs.existsSync(workspacePath)) {
    return errorResponse(`Workspace path does not exist: ${workspacePath}`, 404);
  }

  const files = STANDARD_FILES.map((spec) => getFileInfo(workspacePath, spec));
  return successResponse(files);
}
