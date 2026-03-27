// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to initialize the SQLite database and run schema migrations.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getDb } = await import('./lib/db');
    getDb(); // runs migrations + synchronous first-pass JSONL ingestion

    const { startIngestion } = await import('./lib/ingest');
    startIngestion(); // sets up 5-min background ingestion interval

    const { ensureBridgeStarted } = await import('./lib/gateway-bridge');
    ensureBridgeStarted(); // connects to Gateway immediately so events are captured before any client connects
  }
}
