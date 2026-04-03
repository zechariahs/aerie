// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { requireTotpAuth } from '@/lib/auth';
import { writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';
import { listFolder, writeGoogleDoc } from '@/lib/drive';

/**
 * GET /api/drive/task-specs
 * Lists the Task-Specs/ Drive folder.
 * Returns an empty array (not an error) when Drive is not configured,
 * so the UI can show a "Drive not configured" state gracefully.
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const folderId = process.env['GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID'];
  if (!folderId) {
    return successResponse({ files: [], configured: false });
  }

  const result = await listFolder(folderId);
  if (!result.ok) {
    return errorResponse(result.error, 503, 'DRIVE_ERROR');
  }

  return successResponse({ files: result.files, configured: true });
}

interface WriteTaskSpecBody {
  title: string;
  content: string;
}

/**
 * POST /api/drive/task-specs
 * Writes a new task spec Google Doc to the Task-Specs/ folder.
 * Requires session + TOTP.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireTotpAuth(request);
  if (!auth.ok) {
    if (auth.status === 403) {
      writeAuditLog({ action: 'task-spec.write', resource: 'drive/task-specs', result: 'failure', ip: request.headers.get('x-forwarded-for') ?? 'unknown', userAgent: request.headers.get('user-agent') ?? 'unknown' });
    }
    return errorResponse(auth.status === 401 ? 'Unauthorized' : 'TOTP required', auth.status);
  }

  let body: WriteTaskSpecBody;
  try {
    body = (await request.json()) as WriteTaskSpecBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
    return errorResponse('title is required', 400);
  }
  if (!body.content || typeof body.content !== 'string') {
    return errorResponse('content is required', 400);
  }

  const folderId = process.env['GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID'];
  if (!folderId) {
    return errorResponse('GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID not configured', 503, 'DRIVE_NOT_CONFIGURED');
  }

  const result = await writeGoogleDoc(folderId, body.title.trim(), body.content);
  if (!result.ok) {
    writeAuditLog({
      action: 'task-spec.write',
      resource: 'drive/task-specs',
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse(`Drive write failed: ${result.error}`, 503);
  }

  writeAuditLog({
    action: 'task-spec.write',
    resource: `drive/task-specs:${result.id}`,
    result: 'success',
    ip: request.headers.get('x-forwarded-for') ?? 'unknown',
    userAgent: request.headers.get('user-agent') ?? 'unknown',
  });

  return successResponse({ id: result.id, url: result.url }, 201);
}
