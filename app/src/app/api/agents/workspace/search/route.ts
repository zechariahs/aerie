// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/agents/workspace/search?workspacePath=<absolute>&q=<query>
 *
 * Full-text search over .md, .json, .txt files within the given agent workspace.
 * Returns results sorted by match count descending.
 */

import fs from 'fs';
import path from 'path';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { WorkspaceSearchResult } from '@/types';

export const dynamic = 'force-dynamic';

const SEARCHABLE_EXTS = new Set(['.md', '.json', '.txt']);
const EXCLUDE_NAMES = new Set(['.git', 'node_modules', '__pycache__']);
const MAX_DEPTH = 6;

function searchDir(
  dirPath: string,
  relBase: string,
  query: string,
  results: WorkspaceSearchResult[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;

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
  const workspacePath = searchParams.get('workspacePath');
  const query = searchParams.get('q')?.trim() ?? '';

  if (!workspacePath) return errorResponse('workspacePath is required', 400);
  if (!path.isAbsolute(workspacePath)) return errorResponse('workspacePath must be absolute', 400);
  if (workspacePath.includes('..')) return errorResponse('Invalid workspacePath', 400);
  if (!query) return errorResponse('Missing query parameter q', 400);
  if (query.length < 2) return errorResponse('Query must be at least 2 characters', 400);

  if (!fs.existsSync(workspacePath)) {
    return successResponse<WorkspaceSearchResult[]>([]);
  }

  const results: WorkspaceSearchResult[] = [];
  searchDir(workspacePath, '', query, results, 1);

  results.sort((a, b) => b.matchCount - a.matchCount || a.path.localeCompare(b.path));

  return successResponse(results);
}
