// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getDb } from '@/lib/db';

interface SettingsRow {
  key: string;
  value: string;
}

/** Returns all settings as a key/value map. */
export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as SettingsRow[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}
