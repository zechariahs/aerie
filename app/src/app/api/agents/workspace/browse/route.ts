// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Agent workspace arbitrary file CRUD.
 *
 * GET    ?workspacePath=<absolute>&relPath=<relative>           — read any file
 * POST   { workspacePath, relPath, content }                    — write any file
 * DELETE ?workspacePath=<absolute>&relPath=<relative>           — delete any file
 *
 * Security:
 *  - workspacePath must be absolute, no '..', must exist
 *  - relPath must not contain '..'; resolved path must stay within workspacePath
 */

import fs from 'fs';
import path from 'path';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { WorkspaceFile } from '@/types';

export const dynamic = 'force-dynamic';

function validateWorkspacePath(raw: string | null): string | null {
  if (!raw) return null;
  if (!path.isAbsolute(raw)) return null;
  if (raw.includes('..')) return null;
  return raw;
}

/**
 * Resolves relPath within workspacePath and validates no traversal occurs.
 * Returns the absolute path or throws.
 */
function safeResolve(workspacePath: string, relPath: string): string {
  if (relPath.includes('..')) throw new Error('Path traversal rejected');

  const resolved = path.resolve(workspacePath, relPath);

  // Must be strictly within workspacePath (not equal to it — that's a directory)
  if (!resolved.startsWith(workspacePath + path.sep)) {
    throw new Error('Path traversal rejected');
  }

  return resolved;
}

// GET — read file
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const workspacePath = validateWorkspacePath(searchParams.get('workspacePath'));
  const relPath = searchParams.get('relPath');

  if (!workspacePath) return errorResponse('Invalid or missing workspacePath', 400);
  if (!relPath) return errorResponse('relPath is required', 400);

  let fullPath: string;
  try {
    fullPath = safeResolve(workspacePath, relPath);
  } catch {
    return errorResponse('Invalid path', 400, 'INVALID_PATH');
  }

  if (!fs.existsSync(fullPath)) return errorResponse('File not found', 404);

  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) return errorResponse('Path is not a file', 400);
  if (stat.size > 1_048_576) return errorResponse('File too large (> 1 MB)', 400, 'FILE_TOO_LARGE');

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const ext = path.extname(relPath).slice(1);
    return successResponse<WorkspaceFile>({ path: relPath, content, ext });
  } catch {
    return errorResponse('Failed to read file', 500);
  }
}

// POST — write (create or update)
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  let body: { workspacePath?: string; relPath?: string; content?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const workspacePath = validateWorkspacePath(body.workspacePath ?? null);
  const relPath = body.relPath;
  const { content } = body;

  if (!workspacePath) return errorResponse('Invalid or missing workspacePath', 400);
  if (!relPath) return errorResponse('relPath is required', 400);
  if (typeof content !== 'string') return errorResponse('content must be a string', 400);

  let fullPath: string;
  try {
    fullPath = safeResolve(workspacePath, relPath);
  } catch {
    return errorResponse('Invalid path', 400, 'INVALID_PATH');
  }

  if (!fs.existsSync(workspacePath)) {
    return errorResponse(`Workspace path does not exist: ${workspacePath}`, 404);
  }

  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return successResponse({ ok: true });
  } catch (err) {
    return errorResponse(`Failed to write file: ${String(err)}`, 500);
  }
}

// DELETE — any file within workspace
export async function DELETE(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const workspacePath = validateWorkspacePath(searchParams.get('workspacePath'));
  const relPath = searchParams.get('relPath');

  if (!workspacePath) return errorResponse('Invalid or missing workspacePath', 400);
  if (!relPath) return errorResponse('relPath is required', 400);

  let fullPath: string;
  try {
    fullPath = safeResolve(workspacePath, relPath);
  } catch {
    return errorResponse('Invalid path', 400, 'INVALID_PATH');
  }

  if (!fs.existsSync(fullPath)) return errorResponse('File not found', 404);

  if (!fs.statSync(fullPath).isFile()) {
    return errorResponse('Path is not a file', 400);
  }

  try {
    fs.unlinkSync(fullPath);
    return successResponse({ ok: true });
  } catch (err) {
    return errorResponse(`Failed to delete file: ${String(err)}`, 500);
  }
}
