// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Google Drive API client using a service account.
 *
 * Decodes GOOGLE_SERVICE_ACCOUNT_JSON_B64, parses the JSON, and initialises
 * a googleapis auth client. All functions return a typed error shape rather
 * than throwing — callers must check { ok } before using the result.
 *
 * TODO(session-6): Expand this module with brief assembly and full deliverables
 * browser support when the Claude Integration Loop module is built.
 *
 * REQUIRES_GATEWAY — returns error shapes when Drive env vars are absent.
 */

import type { DriveFile } from '@/types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isConfigured(): boolean {
  return (
    !!process.env['GOOGLE_SERVICE_ACCOUNT_JSON_B64'] &&
    process.env['GOOGLE_SERVICE_ACCOUNT_JSON_B64'] !== ''
  );
}

async function getAuthClient(): Promise<import('googleapis').Auth.GoogleAuth> {
  const b64 = process.env['GOOGLE_SERVICE_ACCOUNT_JSON_B64'];
  if (!b64) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_B64 not set');

  const json = Buffer.from(b64, 'base64').toString('utf-8');
  const credentials: unknown = JSON.parse(json);

  const { google } = await import('googleapis');
  // The service-account JSON shape is accepted by GoogleAuth as credentials.
  // We narrow from unknown via a structural assertion rather than using any.
  type ServiceAccountKey = {
    type: string;
    project_id: string;
    private_key_id: string;
    private_key: string;
    client_email: string;
    client_id: string;
  };
  const key = credentials as ServiceAccountKey;
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: key.client_email,
      private_key: key.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

async function getDriveClient(): Promise<import('googleapis').drive_v3.Drive> {
  const auth = await getAuthClient();
  const { google } = await import('googleapis');
  return google.drive({ version: 'v3', auth });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lists files in a Drive folder, returning metadata only (no content).
 * Returns an empty array when Drive is not configured.
 */
export async function listFolder(
  folderId: string,
): Promise<{ ok: true; files: DriveFile[] } | { ok: false; error: string }> {
  if (!isConfigured()) {
    return { ok: false, error: 'Drive not configured' };
  }

  try {
    const drive = await getDriveClient();
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, createdTime, webViewLink)',
      orderBy: 'createdTime desc',
      pageSize: 50,
    });

    const files = (res.data.files ?? []).map(
      (f): DriveFile => ({
        id: f.id ?? '',
        name: f.name ?? '',
        mimeType: f.mimeType ?? '',
        createdTime: f.createdTime ?? '',
        webViewLink: f.webViewLink ?? '',
      }),
    );

    return { ok: true, files };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Drive error';
    return { ok: false, error: message };
  }
}

/**
 * Creates a Google Doc in the given Drive folder and writes the content.
 * Returns the new file's ID and webViewLink.
 */
export async function writeGoogleDoc(
  folderId: string,
  title: string,
  content: string,
): Promise<{ ok: true; id: string; url: string } | { ok: false; error: string }> {
  if (!isConfigured()) {
    return { ok: false, error: 'Drive not configured' };
  }

  try {
    const drive = await getDriveClient();

    const res = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId],
      },
      media: {
        mimeType: 'text/plain',
        body: content,
      },
      fields: 'id, webViewLink',
    });

    return {
      ok: true,
      id: res.data.id ?? '',
      url: res.data.webViewLink ?? '',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Drive error';
    return { ok: false, error: message };
  }
}

/**
 * Reads the plain-text content of a Google Doc by file ID.
 */
export async function readDoc(
  fileId: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  if (!isConfigured()) {
    return { ok: false, error: 'Drive not configured' };
  }

  try {
    const drive = await getDriveClient();
    const res = await drive.files.export(
      { fileId, mimeType: 'text/plain' },
      { responseType: 'text' },
    );

    return { ok: true, content: String(res.data) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Drive error';
    return { ok: false, error: message };
  }
}
