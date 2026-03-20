// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to initialize the SQLite database and run schema migrations.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getDb } = await import('./lib/db');
    getDb();
  }
}
