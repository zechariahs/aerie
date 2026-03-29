// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * GET /api/agents/workspace/tree?workspacePath=<absolute>
 *
 * Returns a full recursive file tree for the given agent workspace path.
 * Pinned files (SOUL.md, MEMORY.md, etc.) are separated into a top section.
 */

import fs from 'fs';
import path from 'path';
import { getSession } from '@/lib/session';
import { errorResponse, successResponse } from '@/lib/api-response';
import type { WorkspaceTreeNode, WorkspaceTreeData } from '@/types';

export const dynamic = 'force-dynamic';

const PINNED_NAMES = [
  'SOUL.md',
  'MEMORY.md',
  'IDENTITY.md',
  'TOOLS.md',
  'AGENTS.md',
  'SESSION-STATE.md',
  'heartbeat-state.json',
];

const EXCLUDE_NAMES = new Set(['.git', 'node_modules', '__pycache__']);
const EXCLUDE_EXTS = new Set(['.db', '.db-shm', '.db-wal', '.log']);
const MAX_DEPTH = 4;

function buildTree(dirPath: string, relBase: string, depth: number): WorkspaceTreeNode[] {
  if (depth > MAX_DEPTH) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: WorkspaceTreeNode[] = [];
  for (const entry of entries) {
    if (EXCLUDE_NAMES.has(entry.name)) continue;
    const ext = path.extname(entry.name);
    if (EXCLUDE_EXTS.has(ext)) continue;

    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = buildTree(path.join(dirPath, entry.name), relPath, depth + 1);
      nodes.push({ name: entry.name, path: relPath, type: 'directory', children });
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: relPath, type: 'file' });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const workspacePath = searchParams.get('workspacePath');

  if (!workspacePath) return errorResponse('workspacePath is required', 400);
  if (!path.isAbsolute(workspacePath)) return errorResponse('workspacePath must be absolute', 400);
  if (workspacePath.includes('..')) return errorResponse('Invalid workspacePath', 400);

  if (!fs.existsSync(workspacePath)) {
    return successResponse<WorkspaceTreeData>({ pinned: [], tree: [] });
  }

  const allNodes = buildTree(workspacePath, '', 1);

  const pinned: WorkspaceTreeNode[] = [];
  const tree: WorkspaceTreeNode[] = [];

  for (const node of allNodes) {
    if (node.type === 'file' && PINNED_NAMES.includes(node.name)) {
      pinned.push(node);
    } else {
      tree.push(node);
    }
  }

  pinned.sort((a, b) => PINNED_NAMES.indexOf(a.name) - PINNED_NAMES.indexOf(b.name));

  return successResponse<WorkspaceTreeData>({ pinned, tree });
}
