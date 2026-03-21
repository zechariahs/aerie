// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import fs from 'fs';
import path from 'path';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { WorkspaceFile } from '@/types';

function getWorkspaceDir(): string {
  return path.resolve(process.env['OPENCLAW_DIR'] ?? '/openclaw', 'workspace');
}

/**
 * Resolves a relative workspace path and validates it stays within the workspace
 * directory. Path traversal protection: reject any path containing '..' before
 * resolution and verify the resolved path starts with the workspace root.
 */
function safeResolvePath(relativePath: string): string {
  // Reject paths containing '..' as an early signal before resolution
  if (relativePath.includes('..')) {
    throw new Error('Path traversal attempt rejected');
  }

  const workspaceDir = getWorkspaceDir();
  const resolved = path.resolve(workspaceDir, relativePath);

  if (!resolved.startsWith(workspaceDir + path.sep) && resolved !== workspaceDir) {
    throw new Error('Path traversal attempt rejected');
  }

  return resolved;
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const relativePath = searchParams.get('path');

  if (!relativePath) {
    return errorResponse('Missing path parameter', 400);
  }

  // Fixture mode
  if (process.env['USE_FIXTURES'] === 'true') {
    const files = (await import('@/../fixtures/workspace-files.json')).default as Record<
      string,
      string
    >;
    const content = files[relativePath];
    if (content === undefined) {
      return errorResponse('File not found', 404);
    }
    const ext = path.extname(relativePath).slice(1);
    return successResponse<WorkspaceFile>({ path: relativePath, content, ext });
  }

  let resolvedPath: string;
  try {
    resolvedPath = safeResolvePath(relativePath);
  } catch {
    // Path traversal protection: log and reject
    console.error('[workspace] path traversal attempt rejected', { relativePath });
    return errorResponse('Invalid path', 400, 'INVALID_PATH');
  }

  if (!fs.existsSync(resolvedPath)) {
    return errorResponse('File not found', 404);
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    return errorResponse('Path is not a file', 400);
  }

  // Reject files larger than 1 MB to avoid blocking the event loop
  if (stat.size > 1_048_576) {
    return errorResponse('File too large to preview (> 1 MB)', 400, 'FILE_TOO_LARGE');
  }

  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, 'utf-8');
  } catch {
    return errorResponse('Failed to read file', 500);
  }

  const ext = path.extname(relativePath).slice(1);
  return successResponse<WorkspaceFile>({ path: relativePath, content, ext });
}
