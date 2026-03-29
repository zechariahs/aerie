// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

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
export function translateOpenclawPath(p: string): string {
  const containerDir = process.env['OPENCLAW_CONTAINER_DIR'] ?? '/data/.openclaw';
  const aerieMountDir = process.env['OPENCLAW_DIR'] ?? '/openclaw';
  if (p.startsWith(containerDir)) {
    return aerieMountDir + p.slice(containerDir.length);
  }
  return p;
}
