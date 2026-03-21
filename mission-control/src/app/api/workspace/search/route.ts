// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import fs from 'fs';
import path from 'path';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { WorkspaceSearchResult } from '@/types';

const SEARCHABLE_EXTS = new Set(['.md', '.json', '.txt']);
const EXCLUDE_NAMES = new Set(['.git', 'node_modules', '__pycache__']);

function getWorkspaceDir(): string {
  return path.resolve(process.env['OPENCLAW_DIR'] ?? '/openclaw', 'workspace');
}

function searchDir(
  dirPath: string,
  relBase: string,
  query: string,
  results: WorkspaceSearchResult[],
  depth: number,
): void {
  if (depth > 6) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (EXCLUDE_NAMES.has(entry.name)) continue;

    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      searchDir(path.join(dirPath, entry.name), relPath, query, results, depth + 1);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name);
    if (!SEARCHABLE_EXTS.has(ext)) continue;

    let content: string;
    try {
      content = fs.readFileSync(path.join(dirPath, entry.name), 'utf-8');
    } catch {
      continue;
    }

    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();

    let matchCount = 0;
    let firstMatchIdx = -1;
    let idx = lowerContent.indexOf(lowerQuery);

    while (idx !== -1) {
      if (matchCount === 0) firstMatchIdx = idx;
      matchCount++;
      idx = lowerContent.indexOf(lowerQuery, idx + 1);
    }

    if (matchCount === 0) continue;

    // Build an excerpt around the first match: the containing line, trimmed
    const lineStart = content.lastIndexOf('\n', firstMatchIdx) + 1;
    const rawLineEnd = content.indexOf('\n', firstMatchIdx);
    const lineEnd = rawLineEnd === -1 ? content.length : rawLineEnd;
    const line = content.slice(lineStart, lineEnd).trim();
    const excerpt = line.length > 160 ? line.slice(0, 160) + '…' : line;

    results.push({ path: relPath, matchCount, excerpt });
  }
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim() ?? '';

  if (!query) {
    return errorResponse('Missing query parameter q', 400);
  }

  if (query.length < 2) {
    return errorResponse('Query must be at least 2 characters', 400);
  }

  // Fixture mode: search the fixture file map
  if (process.env['USE_FIXTURES'] === 'true') {
    const files = (await import('@/../fixtures/workspace-files.json')).default as Record<
      string,
      string
    >;
    const results: WorkspaceSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const [filePath, content] of Object.entries(files)) {
      const lowerContent = content.toLowerCase();
      let matchCount = 0;
      let firstIdx = -1;
      let pos = lowerContent.indexOf(lowerQuery);
      while (pos !== -1) {
        if (matchCount === 0) firstIdx = pos;
        matchCount++;
        pos = lowerContent.indexOf(lowerQuery, pos + 1);
      }
      if (matchCount === 0) continue;

      const lineStart = content.lastIndexOf('\n', firstIdx) + 1;
      const rawLineEnd = content.indexOf('\n', firstIdx);
      const lineEnd = rawLineEnd === -1 ? content.length : rawLineEnd;
      const line = content.slice(lineStart, lineEnd).trim();
      const excerpt = line.length > 160 ? line.slice(0, 160) + '…' : line;
      results.push({ path: filePath, matchCount, excerpt });
    }

    return successResponse(results);
  }

  const workspaceDir = getWorkspaceDir();

  if (!fs.existsSync(workspaceDir)) {
    return successResponse<WorkspaceSearchResult[]>([]);
  }

  const results: WorkspaceSearchResult[] = [];
  searchDir(workspaceDir, '', query, results, 1);

  // Sort by match count descending, then path alphabetically
  results.sort((a, b) => b.matchCount - a.matchCount || a.path.localeCompare(b.path));

  return successResponse(results);
}
