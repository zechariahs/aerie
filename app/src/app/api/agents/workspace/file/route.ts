// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Agent workspace file operations.
 *
 * GET  /api/agents/workspace/file?workspacePath=<path>&filename=<name>  — read
 * POST /api/agents/workspace/file  body: { workspacePath, filename, content }   — write
 * DELETE /api/agents/workspace/file?workspacePath=<path>&filename=BOOTSTRAP.md  — delete (BOOTSTRAP.md only)
 *
 * Security:
 *  - workspacePath must be absolute and exist
 *  - filename is validated against the standard set (GET/POST) or must be BOOTSTRAP.md (DELETE)
 *  - No path traversal — filename must not contain separators or '..'
 */

import fs from 'fs';
import path from 'path';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';
import { writeFileViaExec, deleteFileViaExec } from '@/lib/openclaw-exec';

export const dynamic = 'force-dynamic';

const ALLOWED_FILENAMES = new Set([
  'AGENTS.md', 'SOUL.md', 'USER.md', 'HEARTBEAT.md', 'BOOT.md',
  'TOOLS.md', 'IDENTITY.md', 'BOOTSTRAP.md', 'MEMORY.md',
]);

function validateWorkspacePath(raw: string | null): string | null {
  if (!raw) return null;
  if (!path.isAbsolute(raw)) return null;
  if (raw.includes('..')) return null;
  return raw;
}

function validateFilename(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) return null;
  if (!ALLOWED_FILENAMES.has(raw)) return null;
  return raw;
}

// GET — read file
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const workspacePath = validateWorkspacePath(searchParams.get('workspacePath'));
  const filename = validateFilename(searchParams.get('filename'));

  if (!workspacePath) return errorResponse('Invalid or missing workspacePath', 400);
  if (!filename) return errorResponse('Invalid or missing filename', 400);

  if (process.env['USE_FIXTURES'] === 'true') {
    return successResponse({ content: `# ${filename}\n\nFixture content for ${filename}.\n` });
  }

  const fullPath = path.join(workspacePath, filename);

  if (!fs.existsSync(fullPath)) {
    return errorResponse('File not found', 404);
  }

  if (!fs.statSync(fullPath).isFile()) {
    return errorResponse('Path is not a file', 400);
  }

  if (fs.statSync(fullPath).size > 1_048_576) {
    return errorResponse('File too large (> 1 MB)', 400, 'FILE_TOO_LARGE');
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    return successResponse({ content });
  } catch {
    return errorResponse('Failed to read file', 500);
  }
}

// POST — write (create or update)
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  let body: { workspacePath?: string; filename?: string; content?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const workspacePath = validateWorkspacePath(body.workspacePath ?? null);
  const filename = validateFilename(body.filename ?? null);
  const { content } = body;

  if (!workspacePath) return errorResponse('Invalid or missing workspacePath', 400);
  if (!filename) return errorResponse('Invalid or missing filename', 400);
  if (typeof content !== 'string') return errorResponse('content must be a string', 400);

  if (process.env['USE_FIXTURES'] === 'true') {
    return successResponse({ ok: true });
  }

  if (!fs.existsSync(workspacePath)) {
    return errorResponse(`Workspace path does not exist: ${workspacePath}`, 404);
  }

  const fullPath = path.join(workspacePath, filename);

  try {
    await writeFileViaExec(fullPath, content);
    return successResponse({ ok: true });
  } catch (err) {
    return errorResponse(`Failed to write file: ${String(err)}`, 500);
  }
}

// DELETE — only BOOTSTRAP.md
export async function DELETE(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const workspacePath = validateWorkspacePath(searchParams.get('workspacePath'));
  const filename = searchParams.get('filename');

  if (!workspacePath) return errorResponse('Invalid or missing workspacePath', 400);
  if (filename !== 'BOOTSTRAP.md') {
    return errorResponse('Only BOOTSTRAP.md can be deleted via this endpoint', 400);
  }

  if (process.env['USE_FIXTURES'] === 'true') {
    return successResponse({ ok: true });
  }

  const fullPath = path.join(workspacePath, 'BOOTSTRAP.md');

  if (!fs.existsSync(fullPath)) {
    return errorResponse('BOOTSTRAP.md not found', 404);
  }

  try {
    await deleteFileViaExec(fullPath);
    return successResponse({ ok: true });
  } catch (err) {
    return errorResponse(`Failed to delete file: ${String(err)}`, 500);
  }
}
