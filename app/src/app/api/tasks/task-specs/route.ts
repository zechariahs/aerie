// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession } from '@/lib/auth';
import { listFolder } from '@/lib/drive';
import { errorResponse, successResponse } from '@/lib/api-response';

/**
 * GET /api/tasks/task-specs
 * Lists Drive docs in the Task-Specs/ folder that have not yet been imported.
 * Returns an empty list (not an error) when Drive is not configured.
 * Folder ID comes from GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID env var.
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const folderId = process.env['GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID'];
  if (!folderId) {
    // Not an error — Drive may not be configured in this environment.
    return successResponse({ files: [], configured: false });
  }

  const result = await listFolder(folderId);

  if (!result.ok) {
    return successResponse({ files: [], configured: true, error: result.error });
  }

  return successResponse({ files: result.files, configured: true });
}
