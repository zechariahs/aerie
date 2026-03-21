// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import fs from 'fs';
import path from 'path';
import { getSession } from '@/lib/session';
import { validateTotpFromRequest } from '@/lib/auth';
import { errorResponse, successResponse } from '@/lib/api-response';
import { writeAuditLog } from '@/lib/db';

// Only SESSION-STATE.md is writable via this endpoint.
// All other workspace files are read-only from the dashboard.
const ALLOWED_FILENAME = 'SESSION-STATE.md';

function getWorkspaceDir(): string {
  return path.resolve(process.env['OPENCLAW_DIR'] ?? '/openclaw', 'workspace');
}

export async function PUT(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  // Every write operation requires a valid TOTP token
  if (!validateTotpFromRequest(request)) {
    writeAuditLog({
      action: 'write session-state',
      resource: ALLOWED_FILENAME,
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse('TOTP required', 403, 'TOTP_REQUIRED');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>)['content'] !== 'string'
  ) {
    return errorResponse('Body must be { content: string }', 400);
  }

  const content = (body as { content: string }).content;

  // In fixture mode, acknowledge the write without touching the filesystem
  if (process.env['USE_FIXTURES'] === 'true') {
    return successResponse({ ok: true, note: 'fixture mode — write not persisted' });
  }

  const workspaceDir = getWorkspaceDir();
  const targetPath = path.join(workspaceDir, ALLOWED_FILENAME);

  try {
    fs.writeFileSync(targetPath, content, 'utf-8');
  } catch (err) {
    writeAuditLog({
      action: 'write session-state',
      resource: ALLOWED_FILENAME,
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    console.error('[workspace] failed to write session-state', err);
    return errorResponse('Failed to write file', 500);
  }

  writeAuditLog({
    action: 'write session-state',
    resource: ALLOWED_FILENAME,
    result: 'success',
    ip: request.headers.get('x-forwarded-for') ?? 'unknown',
    userAgent: request.headers.get('user-agent') ?? 'unknown',
  });

  return successResponse({ ok: true });
}
