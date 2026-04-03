// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getSession, requireTotpAuth } from '@/lib/auth';
import { getDb, writeAuditLog } from '@/lib/db';
import { errorResponse, successResponse } from '@/lib/api-response';
import { assembleBrief } from '@/lib/brief';
import { writeGoogleDoc } from '@/lib/drive';
import type { BriefHistory } from '@/types';

interface BriefHistoryRow {
  id: number;
  title: string;
  drive_url: string;
  created_at: string;
}

function rowToBriefHistory(row: BriefHistoryRow): BriefHistory {
  return {
    id: row.id,
    title: row.title,
    drive_url: row.drive_url,
    created_at: row.created_at,
  };
}

/**
 * GET /api/drive/briefs
 * Returns the last 30 brief history entries from mc.db.
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM brief_history ORDER BY created_at DESC LIMIT 30')
    .all() as BriefHistoryRow[];

  return successResponse(rows.map(rowToBriefHistory));
}

interface GenerateBriefBody {
  notes?: string;
}

/**
 * POST /api/drive/briefs
 * Assembles a brief from live data, writes it to Google Drive (MC-Briefs/ folder),
 * and records it in brief_history.
 * Requires session + TOTP.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireTotpAuth(request);
  if (!auth.ok) {
    if (auth.status === 403) {
      writeAuditLog({ action: 'brief.generate', resource: 'drive/briefs', result: 'failure', ip: request.headers.get('x-forwarded-for') ?? 'unknown', userAgent: request.headers.get('user-agent') ?? 'unknown' });
    }
    return errorResponse(auth.status === 401 ? 'Unauthorized' : 'TOTP required', auth.status);
  }

  let body: GenerateBriefBody = {};
  try {
    body = (await request.json()) as GenerateBriefBody;
  } catch {
    // notes is optional — empty body is fine
  }

  const notes = typeof body.notes === 'string' ? body.notes : '';

  // Assemble the brief markdown
  let markdown: string;
  try {
    markdown = await assembleBrief(notes);
  } catch (err) {
    console.error('[drive/briefs] brief assembly failed', err);
    return errorResponse('Brief assembly failed', 500);
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const title = `MC Brief — ${dateStr}`;

  const folderId = process.env['GOOGLE_DRIVE_MC_BRIEFS_FOLDER_ID'];
  if (!folderId) {
    return errorResponse('GOOGLE_DRIVE_MC_BRIEFS_FOLDER_ID not configured', 503, 'DRIVE_NOT_CONFIGURED');
  }

  // Write to Google Drive
  const driveResult = await writeGoogleDoc(folderId, title, markdown);
  if (!driveResult.ok) {
    writeAuditLog({
      action: 'brief.generate',
      resource: 'drive/briefs',
      result: 'failure',
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse(`Drive write failed: ${driveResult.error}`, 503);
  }

  // Persist to brief_history
  const db = getDb();
  const insertStmt = db.prepare(
    'INSERT INTO brief_history (title, drive_url) VALUES (?, ?)',
  );
  const info = insertStmt.run(title, driveResult.url);
  const newRow = db
    .prepare('SELECT * FROM brief_history WHERE id = ?')
    .get(info.lastInsertRowid) as BriefHistoryRow;

  writeAuditLog({
    action: 'brief.generate',
    resource: `brief:${newRow.id}`,
    result: 'success',
    ip: request.headers.get('x-forwarded-for') ?? 'unknown',
    userAgent: request.headers.get('user-agent') ?? 'unknown',
  });

  return successResponse({ brief: rowToBriefHistory(newRow), driveUrl: driveResult.url }, 201);
}
