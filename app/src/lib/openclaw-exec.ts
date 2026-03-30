// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { spawn } from 'child_process';
import fs from 'fs';

/**
 * Returns the binary and args to use for an openclaw CLI invocation.
 *
 * When OPENCLAW_CONTAINER_NAME is set (production Docker), routes the call
 * through `docker exec <container> openclaw ...` so the binary inside the
 * openclaw container is used. Falls back to bare `openclaw` for local dev.
 */
export function getOpenclawExec(clawArgs: string[]): { bin: string; args: string[] } {
  const container = process.env['OPENCLAW_CONTAINER_NAME'];
  if (container) {
    return { bin: 'docker', args: ['exec', container, 'openclaw', ...clawArgs] };
  }
  return { bin: 'openclaw', args: clawArgs };
}

/**
 * Translates a path returned by the openclaw CLI (relative to the openclaw
 * container's data root) into the equivalent path inside the Aerie container
 * (where the same directory is mounted at OPENCLAW_DIR).
 *
 * Example: /data/.openclaw/workspace → /openclaw/workspace
 *
 * OPENCLAW_CONTAINER_DIR: path prefix inside the openclaw container (default /data/.openclaw)
 * OPENCLAW_DIR:           where that directory is mounted in Aerie    (default /openclaw)
 */
/**
 * Translates an Aerie mount path back to the equivalent path inside the
 * openclaw container. This is the reverse of translateOpenclawPath.
 *
 * Example: /openclaw/workspace → /data/.openclaw/workspace
 */
function toContainerPath(absPath: string): string {
  const aerieMountDir = process.env['OPENCLAW_DIR'] ?? '/openclaw';
  const containerDir = process.env['OPENCLAW_CONTAINER_DIR'] ?? '/data/.openclaw';
  if (absPath.startsWith(aerieMountDir)) {
    return containerDir + absPath.slice(aerieMountDir.length);
  }
  return absPath;
}

/**
 * Writes content to a file, routing through docker exec when
 * OPENCLAW_CONTAINER_NAME is set (production). Falls back to direct
 * fs.writeFileSync in dev mode (no container).
 *
 * Uses `docker exec -i <container> tee <path>` with content piped via stdin
 * so that the file is created with the correct ownership inside the container.
 */
export function writeFileViaExec(absPath: string, content: string): Promise<void> {
  const container = process.env['OPENCLAW_CONTAINER_NAME'];
  if (!container) {
    fs.writeFileSync(absPath, content, 'utf-8');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const containerPath = toContainerPath(absPath);
    const child = spawn('docker', ['exec', '-i', container, 'tee', containerPath], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: unknown) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`docker exec tee exited ${code}: ${stderr.trim()}`));
    });
    child.stdin.write(content, 'utf-8');
    child.stdin.end();
  });
}

/**
 * Deletes a file, routing through docker exec when OPENCLAW_CONTAINER_NAME
 * is set. Falls back to fs.unlinkSync in dev mode.
 */
export function deleteFileViaExec(absPath: string): Promise<void> {
  const container = process.env['OPENCLAW_CONTAINER_NAME'];
  if (!container) {
    fs.unlinkSync(absPath);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', container, 'rm', '-f', toContainerPath(absPath)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: unknown) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`docker exec rm exited ${code}: ${stderr.trim()}`));
    });
  });
}

/**
 * Creates a directory (recursively), routing through docker exec when
 * OPENCLAW_CONTAINER_NAME is set. Falls back to fs.mkdirSync in dev mode.
 */
export function mkdirViaExec(absPath: string): Promise<void> {
  const container = process.env['OPENCLAW_CONTAINER_NAME'];
  if (!container) {
    fs.mkdirSync(absPath, { recursive: true });
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', container, 'mkdir', '-p', toContainerPath(absPath)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: unknown) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`docker exec mkdir exited ${code}: ${stderr.trim()}`));
    });
  });
}

export function translateOpenclawPath(p: string): string {
  const containerDir = process.env['OPENCLAW_CONTAINER_DIR'] ?? '/data/.openclaw';
  const aerieMountDir = process.env['OPENCLAW_DIR'] ?? '/openclaw';
  if (p.startsWith(containerDir)) {
    return aerieMountDir + p.slice(containerDir.length);
  }
  return p;
}
