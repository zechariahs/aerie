// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database | undefined;

/**
 * Returns the singleton SQLite database instance.
 * Creates the data directory and runs schema migrations on first call.
 * Safe to call multiple times — returns the same instance.
 */
export function getDb(): Database.Database {
  if (db) return db;

  const dataDir = process.env['MC_DATA_DIR'] ?? '/app/data';
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'mc.db');
  db = new Database(dbPath);

  // WAL mode for concurrent reads during writes
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'inbox',
      priority    TEXT NOT NULL DEFAULT 'P3',
      tag         TEXT,
      assigned_agent TEXT,
      due_date    TEXT,
      linked_output TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status  TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
      action     TEXT NOT NULL,
      resource   TEXT NOT NULL,
      result     TEXT NOT NULL,
      ip         TEXT NOT NULL,
      user_agent TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS brief_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      drive_url  TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cron_runs (
      id             TEXT PRIMARY KEY,
      cron_id        TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'running',
      started_at     TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at    TEXT,
      duration_ms    INTEGER,
      output_excerpt TEXT,
      drive_url      TEXT,
      error_message  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_cron_runs_cron_id ON cron_runs (cron_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS task_comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_status_changes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status   TEXT NOT NULL,
      changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_task_status_changes_task_id ON task_status_changes (task_id, changed_at DESC);
  `);
}

/**
 * Inserts an audit log entry. Call this for every write operation
 * regardless of success or failure.
 */
export function writeAuditLog(entry: {
  action: string;
  resource: string;
  result: 'success' | 'failure';
  ip: string;
  userAgent: string;
}): void {
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO audit_log (action, resource, result, ip, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
  );
  stmt.run(entry.action, entry.resource, entry.result, entry.ip, entry.userAgent);
}
