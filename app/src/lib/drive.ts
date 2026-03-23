// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Google Drive API client using OAuth2 with a refresh token.
 *
 * Reads GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and
 * GOOGLE_OAUTH_REFRESH_TOKEN to initialise a googleapis OAuth2 client.
 * All functions return a typed error shape rather than throwing — callers
 * must check { ok } before using the result.
 *
 * REQUIRES_GATEWAY — returns error shapes when Drive env vars are absent.
 */

import type { DriveFile } from '@/types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isConfigured(): boolean {
  return (
    !!process.env['GOOGLE_OAUTH_CLIENT_ID'] &&
    !!process.env['GOOGLE_OAUTH_CLIENT_SECRET'] &&
    !!process.env['GOOGLE_OAUTH_REFRESH_TOKEN']
  );
}

async function getDriveClient(): Promise<import('googleapis').drive_v3.Drive> {
  const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_OAUTH_CLIENT_SECRET'];
  const refreshToken = process.env['GOOGLE_OAUTH_REFRESH_TOKEN'];

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google OAuth credentials not configured');
  }

  const { google } = await import('googleapis');
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lists files in a Drive folder, returning metadata only (no content).
 * Returns an error shape when Drive is not configured.
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
