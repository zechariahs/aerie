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
