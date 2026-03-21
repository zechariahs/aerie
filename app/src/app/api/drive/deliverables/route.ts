// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession } from '@/lib/auth';
import { errorResponse, successResponse } from '@/lib/api-response';
import { listFolder } from '@/lib/drive';
import type { DriveFile } from '@/types';

/**
 * GET /api/drive/deliverables
 * Lists the research and personal Drive folders in parallel.
 * Returns { stg: DriveFile[], personal: DriveFile[], configured: boolean }.
 * Returns empty arrays (not an error) when folder env vars are not set.
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const stgFolderId = process.env['GOOGLE_DRIVE_STG_FOLDER_ID'];
  const personalFolderId = process.env['GOOGLE_DRIVE_PERSONAL_FOLDER_ID'];

  if (!stgFolderId && !personalFolderId) {
    return successResponse({
      stg: [] as DriveFile[],
      personal: [] as DriveFile[],
      configured: false,
    });
  }

  const [stgResult, personalResult] = await Promise.all([
    stgFolderId ? listFolder(stgFolderId) : Promise.resolve({ ok: true as const, files: [] as DriveFile[] }),
    personalFolderId ? listFolder(personalFolderId) : Promise.resolve({ ok: true as const, files: [] as DriveFile[] }),
  ]);

  // Surface errors as warnings — partial data is better than a full 503
  const stg = stgResult.ok ? stgResult.files : [];
  const personal = personalResult.ok ? personalResult.files : [];

  const errors: string[] = [];
  if (!stgResult.ok) errors.push(`Research: ${stgResult.error}`);
  if (!personalResult.ok) errors.push(`Personal: ${personalResult.error}`);

  return successResponse({
    stg,
    personal,
    configured: true,
    ...(errors.length > 0 ? { warnings: errors } : {}),
  });
}
