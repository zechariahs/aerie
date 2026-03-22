// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT
//
// Pre-deployment validation suite.
// Usage: pnpm exec tsx scripts/preflight.ts

import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GREY = '\x1b[90m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

type Status = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

function color(status: Status): string {
  switch (status) {
    case 'PASS': return GREEN;
    case 'FAIL': return RED;
    case 'WARN': return YELLOW;
    case 'SKIP': return GREY;
  }
}

function line(status: Status, label: string, detail: string): void {
  const c = color(status);
  console.log(`${c}[${status}]${RESET} ${label} — ${detail}`);
}

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

let passed = 0;
let warned = 0;
let failed = 0;
let skipped = 0;

function record(status: Status): void {
  switch (status) {
    case 'PASS': passed++; break;
    case 'WARN': warned++; break;
    case 'FAIL': failed++; break;
    case 'SKIP': skipped++; break;
  }
}

// ---------------------------------------------------------------------------
// Check 1 — Env var completeness
// ---------------------------------------------------------------------------

function checkEnvVars(): void {
  const label = 'Env vars';

  // Parse app/.env.example — extract keys whose value is empty or a placeholder
  const envExamplePath = path.resolve(__dirname, '..', '.env.example');
  let raw: string;
  try {
    raw = fs.readFileSync(envExamplePath, 'utf8');
  } catch {
    line('FAIL', label, `.env.example not found at ${envExamplePath}`);
    record('FAIL');
    return;
  }

  const requiredKeys: string[] = [];
  for (const rawLine of raw.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).split('#')[0]!.trim();
    // Empty value or placeholder (contains <...>)
    if (val === '' || /^<.+>$/.test(val)) {
      requiredKeys.push(key);
    }
  }

  const missing = requiredKeys.filter((k) => !process.env[k]);

  if (missing.length === 0) {
    line('PASS', label, `all ${requiredKeys.length} required variables set`);
    record('PASS');
  } else {
    line('FAIL', label, `missing: ${missing.join(', ')}`);
    record('FAIL');
  }
}

// ---------------------------------------------------------------------------
// Check 2 — OpenClaw mount
// ---------------------------------------------------------------------------

function checkOpenclawMount(): void {
  const label = 'OpenClaw mount';
  const base = process.env['OPENCLAW_DIR'] ?? '/openclaw';
  const targets = [
    path.join(base, 'cron', 'jobs.json'),
    path.join(base, 'workspace'),
  ];

  const missing: string[] = [];
  for (const t of targets) {
    try {
      fs.accessSync(t, fs.constants.R_OK);
    } catch {
      missing.push(t);
    }
  }

  if (missing.length === 0) {
    line('PASS', label, `cron/jobs.json readable at ${targets[0]}`);
    record('PASS');
  } else {
    for (const m of missing) {
      line('FAIL', label, `not found: ${m}`);
    }
    record('FAIL');
  }
}

// ---------------------------------------------------------------------------
// Check 3 — SQLite write test
// ---------------------------------------------------------------------------

function checkSqliteWrite(): void {
  const label = 'SQLite write';
  const dataDir = process.env['MC_DATA_DIR'] ?? '/app/data';
  const dbPath = path.join(dataDir, 'mc.db');

  try {
    // Dynamic import to avoid loading at module level
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    const db = new Database(dbPath);

    try {
      // Ensure WAL mode and table exist
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');

      // Create table if not exists (mirrors migration)
      db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
        action     TEXT NOT NULL,
        resource   TEXT NOT NULL,
        result     TEXT NOT NULL,
        ip         TEXT NOT NULL,
        user_agent TEXT NOT NULL
      )`);

      const insert = db.prepare(
        `INSERT INTO audit_log (action, resource, result, ip, user_agent)
         VALUES ('preflight', 'preflight-script', 'ok', '127.0.0.1', 'preflight/1.0')`
      );
      const info = insert.run();
      const rowId = info.lastInsertRowid;

      const row = db.prepare('SELECT id FROM audit_log WHERE id = ?').get(rowId);
      if (!row) throw new Error('SELECT returned no row');

      db.prepare('DELETE FROM audit_log WHERE id = ?').run(rowId);

      line('PASS', label, `mc.db writable at ${dbPath}`);
      record('PASS');
    } finally {
      db.close();
    }
  } catch (err) {
    line('FAIL', label, `SQLite error: ${String(err)}`);
    record('FAIL');
  }
}

// ---------------------------------------------------------------------------
// Check 4 — Host agent reachability
// ---------------------------------------------------------------------------

async function checkHostAgent(): Promise<void> {
  const label = 'Host agent';
  const baseUrl = process.env['HOST_AGENT_URL'] ?? 'http://127.0.0.1:3101';
  const token = process.env['HOST_AGENT_TOKEN'] ?? '';
  const url = `${baseUrl}/metrics`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    let status: number;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      status = res.status;
    } finally {
      clearTimeout(timer);
    }

    if (status === 200) {
      line('PASS', label, `reachable at ${baseUrl}`);
      record('PASS');
    } else if (status === 401 || status === 403) {
      line('FAIL', label, `auth rejected (${status}) at ${baseUrl}`);
      record('FAIL');
    } else {
      line('WARN', label, `unexpected status ${status} at ${baseUrl}`);
      record('WARN');
    }
  } catch (err) {
    const msg = String(err);
    const isConnRefused =
      msg.includes('ECONNREFUSED') ||
      msg.includes('abort') ||
      msg.includes('fetch failed') ||
      msg.includes('ETIMEDOUT');
    if (isConnRefused) {
      line('WARN', label, `unreachable at ${baseUrl} (may not be running yet)`);
      record('WARN');
    } else {
      line('FAIL', label, `error: ${msg}`);
      record('FAIL');
    }
  }
}

// ---------------------------------------------------------------------------
// Check 5 — OpenRouter API key
// ---------------------------------------------------------------------------

async function checkOpenRouter(): Promise<void> {
  const label = 'OpenRouter API key';
  const apiKey = process.env['OPENROUTER_API_KEY'] ?? '';

  if (!apiKey) {
    line('SKIP', label, 'OPENROUTER_API_KEY not set');
    record('SKIP');
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    let status: number;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      status = res.status;
    } finally {
      clearTimeout(timer);
    }

    if (status === 200) {
      line('PASS', label, 'valid');
      record('PASS');
    } else if (status === 401 || status === 403) {
      line('FAIL', label, `rejected (${status})`);
      record('FAIL');
    } else {
      line('WARN', label, `unexpected status ${status}`);
      record('WARN');
    }
  } catch (err) {
    const msg = String(err);
    const isNetwork =
      msg.includes('fetch failed') || msg.includes('abort') || msg.includes('ENOTFOUND');
    if (isNetwork) {
      line('WARN', label, 'network unreachable');
      record('WARN');
    } else {
      line('FAIL', label, `error: ${msg}`);
      record('FAIL');
    }
  }
}

// ---------------------------------------------------------------------------
// Check 6 — Google Drive service account
// ---------------------------------------------------------------------------

async function checkGoogleDrive(): Promise<void> {
  const label = 'Google Drive';
  const b64 = process.env['GOOGLE_SERVICE_ACCOUNT_JSON_B64'] ?? '';

  if (!b64) {
    line('SKIP', label, 'GOOGLE_SERVICE_ACCOUNT_JSON_B64 not set');
    record('SKIP');
    return;
  }

  let saJson: Record<string, unknown>;
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    saJson = JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    line('FAIL', label, 'GOOGLE_SERVICE_ACCOUNT_JSON_B64 is not valid base64 JSON');
    record('FAIL');
    return;
  }

  if (saJson['type'] !== 'service_account') {
    line('FAIL', label, 'parsed JSON is not a service_account credential');
    record('FAIL');
    return;
  }

  const folderId = process.env['GOOGLE_DRIVE_MC_BRIEFS_FOLDER_ID'] ?? '';
  if (!folderId) {
    line('FAIL', label, 'GOOGLE_DRIVE_MC_BRIEFS_FOLDER_ID not set');
    record('FAIL');
    return;
  }

  // Use googleapis to list the folder
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { google } = require('googleapis') as typeof import('googleapis');
    const auth = new google.auth.GoogleAuth({
      credentials: saJson,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });
    const res = await drive.files.list({
      q: `'${folderId}' in parents`,
      pageSize: 1,
      fields: 'files(id,name)',
    });

    if (res.status === 200) {
      line('PASS', label, 'MC-Briefs folder accessible');
      record('PASS');
    } else {
      line('FAIL', label, `unexpected status ${res.status}`);
      record('FAIL');
    }
  } catch (err) {
    const msg = String(err);
    const isNetwork =
      msg.includes('ENOTFOUND') || msg.includes('fetch failed') || msg.includes('ETIMEDOUT');
    if (isNetwork) {
      line('WARN', label, 'network unreachable');
      record('WARN');
    } else if (msg.includes('401') || msg.includes('403') || msg.includes('invalid_grant')) {
      line('FAIL', label, `auth error: ${msg}`);
      record('FAIL');
    } else if (msg.includes('404') || msg.includes('not found')) {
      line('FAIL', label, 'folder not found');
      record('FAIL');
    } else {
      line('FAIL', label, `error: ${msg}`);
      record('FAIL');
    }
  }
}

// ---------------------------------------------------------------------------
// Check 7 — Docker build
// ---------------------------------------------------------------------------

function checkDockerBuild(): void {
  const label = 'Docker build';

  // Check docker CLI availability
  try {
    execSync('docker info --format "{{.ServerVersion}}"', { stdio: 'pipe', timeout: 10_000 });
  } catch {
    line('WARN', label, 'docker CLI unavailable — skipping build check');
    record('WARN');
    return;
  }

  const repoRoot = path.resolve(__dirname, '..', '..');
  const result = spawnSync(
    'docker',
    ['build', '-t', 'aerie:preflight', './app'],
    {
      cwd: repoRoot,
      timeout: 5 * 60 * 1000,
      encoding: 'utf8',
    }
  );

  if (result.status === 0) {
    line('PASS', label, 'image built successfully');
    record('PASS');
  } else {
    const stderr = (result.stderr ?? '') + (result.stdout ?? '');
    const lastLines = stderr.split('\n').slice(-20).join('\n');
    line('FAIL', label, 'failed (last 20 lines of output follow)');
    record('FAIL');
    console.log(lastLines);
  }
}

// ---------------------------------------------------------------------------
// Check 8 — Import integrity
// ---------------------------------------------------------------------------

function checkImportIntegrity(): void {
  const label = 'Import integrity';
  const srcDir = path.resolve(__dirname, '..', 'src');

  const result = spawnSync(
    'grep',
    ['-r', 'mission-control\\|mission_control', srcDir, '--include=*.ts', '--include=*.tsx', '-l'],
    { encoding: 'utf8' }
  );

  const hits = (result.stdout ?? '').trim();

  if (!hits) {
    line('PASS', label, 'no stale mission-control/ references in app/src/');
    record('PASS');
  } else {
    const files = hits.split('\n').filter(Boolean);
    line('FAIL', label, `stale references found in:\n  ${files.join('\n  ')}`);
    record('FAIL');
  }
}

// ---------------------------------------------------------------------------
// Check 9 — Next.js build
// ---------------------------------------------------------------------------

function checkNextBuild(): void {
  const label = 'Next.js build';
  const appDir = path.resolve(__dirname, '..');

  const result = spawnSync('pnpm', ['build'], {
    cwd: appDir,
    timeout: 5 * 60 * 1000,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  if (result.status === 0) {
    line('PASS', label, 'build succeeded');
    record('PASS');
  } else {
    const output = ((result.stderr ?? '') + (result.stdout ?? '')).split('\n').slice(-30).join('\n');
    line('FAIL', label, 'build failed (last 30 lines follow)');
    record('FAIL');
    console.log(output);
  }
}

// ---------------------------------------------------------------------------
// Check 10 — TOTP clock skew
// ---------------------------------------------------------------------------

async function checkClockSkew(): Promise<void> {
  const label = 'TOTP clock skew';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    let body: Record<string, unknown>;
    try {
      const res = await fetch('https://worldtimeapi.org/api/ip', {
        signal: controller.signal,
      });
      body = (await res.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }

    const remoteTs = body['unixtime'];
    if (typeof remoteTs !== 'number') {
      line('SKIP', label, 'unexpected API response format');
      record('SKIP');
      return;
    }

    const localTs = Math.floor(Date.now() / 1000);
    const skewSec = Math.abs(localTs - remoteTs);

    if (skewSec > 30) {
      line('WARN', label, `clock skew ${skewSec}s exceeds TOTP tolerance of 30s`);
      record('WARN');
    } else {
      line('PASS', label, `clock skew ${skewSec}s — within tolerance`);
      record('PASS');
    }
  } catch {
    line('SKIP', label, 'time API unreachable');
    record('SKIP');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\n${BOLD}Aerie — Pre-Deployment Validation${RESET}\n`);

  checkEnvVars();
  checkOpenclawMount();
  checkSqliteWrite();
  await checkHostAgent();
  await checkOpenRouter();
  await checkGoogleDrive();
  checkDockerBuild();
  checkImportIntegrity();
  checkNextBuild();
  await checkClockSkew();

  const total = passed + warned + failed + skipped;
  const nonSkip = total - skipped;

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`${passed}/${nonSkip} checks passed.${warned > 0 ? ` ${warned} warning(s).` : ''}`);

  if (failed === 0) {
    console.log(`${GREEN}${BOLD}READY TO DEPLOY.${RESET}`);
  } else {
    console.log(`${RED}${BOLD}NOT READY — fix ${failed} failure(s) above before deploying.${RESET}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
