// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT
//
// Host Agent — runs on the VPS HOST (not inside Docker).
// Reads /proc/* and docker stats, exposes a single JSON HTTP API on 127.0.0.1:3101.
// Aerie proxies to this; it is never exposed directly to the internet.
//
// Start: node dist/index.js (after tsc build) or tsx index.ts for dev

import http from 'http';
import { execFile } from 'child_process';
import fs from 'fs';
import chokidar from 'chokidar';

const PORT = parseInt(process.env['HOST_AGENT_PORT'] ?? '3101', 10);
// Bind to all interfaces so Docker containers can reach us via host.docker.internal.
// Security is enforced by the isAllowedIp() check in the request handler, which
// restricts to loopback and Docker bridge ranges (172.16.0.0/12) only.
const BIND_ADDRESS = process.env['HOST_AGENT_BIND'] ?? '0.0.0.0';
const HOST_AGENT_TOKEN = process.env['HOST_AGENT_TOKEN'];
const OPENCLAW_DATA_DIR = process.env['OPENCLAW_DATA_DIR'] ?? '/docker/openclaw-v5t3/data/.openclaw';

// Allowlist of container names the agent may restart.
// Read from ALLOWED_RESTART_CONTAINERS env var (comma-separated).
// User input must exactly match a name from this set — no interpolation.
const ALLOWED_CONTAINERS = new Set(
  process.env['ALLOWED_RESTART_CONTAINERS']?.split(',').map((s) => s.trim()).filter(Boolean) ?? [],
);

interface CpuSample {
  idle: number;
  total: number;
}

interface NetSample {
  rxBytes: number;
  txBytes: number;
}

let lastCpuSample: CpuSample | undefined;

function readFile(path: string): string {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function parseCpuPercent(): number {
  const stat = readFile('/proc/stat');
  const line = stat.split('\n')[0] ?? '';
  const parts = line.split(/\s+/).slice(1).map(Number);

  const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
  const total = parts.reduce((sum, v) => sum + v, 0);

  if (!lastCpuSample) {
    lastCpuSample = { idle, total };
    return 0;
  }

  const diffIdle = idle - lastCpuSample.idle;
  const diffTotal = total - lastCpuSample.total;
  lastCpuSample = { idle, total };

  if (diffTotal === 0) return 0;
  return Math.round(((diffTotal - diffIdle) / diffTotal) * 100 * 10) / 10;
}

function parseMemory(): { used_mb: number; total_mb: number } {
  const meminfo = readFile('/proc/meminfo');
  const get = (key: string): number => {
    const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return match?.[1] ? parseInt(match[1], 10) : 0;
  };

  const total = get('MemTotal');
  const available = get('MemAvailable');
  return {
    total_mb: Math.round(total / 1024),
    used_mb: Math.round((total - available) / 1024),
  };
}

function parseLoadAvg(): [number, number, number] {
  const raw = readFile('/proc/loadavg').trim().split(' ');
  return [
    parseFloat(raw[0] ?? '0'),
    parseFloat(raw[1] ?? '0'),
    parseFloat(raw[2] ?? '0'),
  ];
}

function parseUptime(): number {
  const raw = readFile('/proc/uptime').trim().split(' ');
  return parseFloat(raw[0] ?? '0');
}

/** Detect the primary non-loopback network interface from /proc/net/dev. */
function detectPrimaryInterface(): string {
  const raw = readFile('/proc/net/dev');
  const lines = raw.split('\n').slice(2); // skip two header lines
  for (const line of lines) {
    const iface = line.trim().split(':')[0]?.trim() ?? '';
    if (iface && iface !== 'lo') return iface;
  }
  return 'eth0';
}

/** Read rx/tx byte counters for the given interface from /proc/net/dev. */
function readNetSample(iface: string): NetSample {
  const raw = readFile('/proc/net/dev');
  const line = raw.split('\n').find((l) => l.trim().startsWith(iface + ':'));
  if (!line) return { rxBytes: 0, txBytes: 0 };
  // Format after "iface:": rx_bytes rx_packets rx_errs rx_drop rx_fifo rx_frame rx_compressed rx_multicast tx_bytes ...
  const parts = line.trim().split(/\s+/);
  // parts[0] = "iface:", parts[1] = rx_bytes, parts[9] = tx_bytes
  return {
    rxBytes: parseInt(parts[1] ?? '0', 10),
    txBytes: parseInt(parts[9] ?? '0', 10),
  };
}

/**
 * Computes network throughput for the primary interface by sampling /proc/net/dev
 * twice 500 ms apart and computing bytes/sec.
 */
function getNetworkDelta(): Promise<{ in_bps: number; out_bps: number }> {
  return new Promise((resolve) => {
    const iface = detectPrimaryInterface();
    const before = readNetSample(iface);
    setTimeout(() => {
      const after = readNetSample(iface);
      // Multiply by 2 because the window is 500 ms (half a second)
      const in_bps = Math.max(0, (after.rxBytes - before.rxBytes) * 2);
      const out_bps = Math.max(0, (after.txBytes - before.txBytes) * 2);
      resolve({ in_bps, out_bps });
    }, 500);
  });
}

/** Parse a human-readable uptime string from docker ps Status column into seconds. */
function parseUptimeFromStatus(status: string): number {
  const match = status.match(/Up\s+(\d+)\s+(\w+)/i);
  if (!match) return 0;
  const value = parseInt(match[1] ?? '0', 10);
  const unit = match[2]?.toLowerCase() ?? '';
  if (unit.startsWith('second')) return value;
  if (unit.startsWith('minute')) return value * 60;
  if (unit.startsWith('hour')) return value * 3600;
  if (unit.startsWith('day')) return value * 86400;
  if (unit.startsWith('week')) return value * 604800;
  return 0;
}

function getDiskStats(): Promise<{ used_bytes: number; total_bytes: number }> {
  return new Promise((resolve) => {
    // execFile with hardcoded args — no user input interpolation.
    // -B 1 outputs exact byte counts for accurate GB conversion.
    execFile('df', ['-B', '1', '--output=used,size', '/'], { timeout: 3000 }, (_err, stdout) => {
      const lines = stdout.trim().split('\n');
      // Line 0 is header, line 1 is root filesystem data
      const dataLine = lines[1] ?? '';
      const parts = dataLine.trim().split(/\s+/);
      resolve({
        used_bytes: parseInt(parts[0] ?? '0', 10),
        total_bytes: parseInt(parts[1] ?? '0', 10),
      });
    });
  });
}

function getDockerStats(): Promise<Array<{ name: string; status: string; cpu_pct: number; mem_mb: number; uptime_seconds: number }>> {
  return new Promise((resolve) => {
    // execFile with hardcoded args — no user input interpolation
    execFile(
      'docker',
      ['stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'],
      { timeout: 10000 },
      (_statsErr, statsStdout) => {
        const statsLines = statsStdout.trim().split('\n').filter(Boolean);
        const statsMap = new Map<string, { cpu_pct: number; mem_mb: number }>();

        for (const line of statsLines) {
          const [name = '', cpu = '0%', mem = '0MiB'] = line.split('\t');
          const cpu_pct = parseFloat(cpu.replace('%', '')) || 0;
          const mem_mb = parseFloat(mem.split('/')[0]?.replace(/[^0-9.]/g, '') ?? '0') || 0;
          statsMap.set(name, { cpu_pct, mem_mb });
        }

        // Get container status/uptime from docker ps
        execFile(
          'docker',
          ['ps', '--format', '{{.Names}}\t{{.Status}}'],
          { timeout: 5000 },
          (_psErr, psStdout) => {
            const psLines = psStdout.trim().split('\n').filter(Boolean);
            const result = psLines.map((line) => {
              const [name = '', statusStr = ''] = line.split('\t');
              const stats = statsMap.get(name) ?? { cpu_pct: 0, mem_mb: 0 };
              return {
                name,
                status: 'running',
                cpu_pct: stats.cpu_pct,
                mem_mb: stats.mem_mb,
                uptime_seconds: parseUptimeFromStatus(statusStr),
              };
            });
            resolve(result);
          },
        );
      },
    );
  });
}

function getServiceStatus(): Promise<{ nginx: string; openclaw_gateway: boolean }> {
  // The openclaw container name comes from the first entry in ALLOWED_RESTART_CONTAINERS,
  // or falls back to 'openclaw' as a partial name filter if not configured.
  const openclawContainerName = process.env['OPENCLAW_CONTAINER_NAME'] ?? 'openclaw';
  return new Promise((resolve) => {
    execFile('systemctl', ['is-active', 'nginx'], { timeout: 3000 }, (_err, stdout) => {
      const nginx = stdout.trim();
      // Check if the openclaw container is running by filtering docker ps output
      execFile(
        'docker',
        ['ps', '--filter', `name=${openclawContainerName}`, '--format', '{{.Names}}'],
        { timeout: 5000 },
        (_dockerErr, dockerStdout) => {
          resolve({ nginx, openclaw_gateway: dockerStdout.trim().length > 0 });
        },
      );
    });
  });
}

function isAllowedIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  // Allow Docker bridge networks (172.16.0.0/12)
  const match = ip.match(/^(?:::ffff:)?172\.(1[6-9]|2[0-9]|3[0-1])\./);
  return match !== null;
}

function requireBearerAuth(req: http.IncomingMessage): boolean {
  if (!HOST_AGENT_TOKEN) return false;
  const auth = req.headers['authorization'];
  return auth === `Bearer ${HOST_AGENT_TOKEN}`;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// JSONL tail watcher — streams new lines from cron run and session files
// ---------------------------------------------------------------------------

interface SseEnvelope {
  ts: string;
  source: 'cron_run' | 'session';
  agentId: string | null;
  sessionId: string | null;
  type: string;
  raw: Record<string, unknown>;
}

/** Byte-offset cursor per watched file. Set to current file size on add (no history replay). */
const fileOffsets = new Map<string, number>();

/** All currently connected SSE clients. */
const sseClients = new Set<http.ServerResponse>();

/** Parse a file path to determine its source type and path-derived IDs. */
function parseFilePath(filePath: string): {
  source: 'cron_run' | 'session';
  pathAgentId: string | null;
  pathSessionId: string | null;
} {
  const cronMatch = filePath.match(/\/cron\/runs\/([^/]+)\.jsonl$/);
  if (cronMatch) {
    return { source: 'cron_run', pathAgentId: cronMatch[1] ?? null, pathSessionId: null };
  }
  const sessionMatch = filePath.match(/\/agents\/([^/]+)\/sessions\/([^/]+)\.jsonl$/);
  if (sessionMatch) {
    return { source: 'session', pathAgentId: sessionMatch[1] ?? null, pathSessionId: sessionMatch[2] ?? null };
  }
  return { source: 'session', pathAgentId: null, pathSessionId: null };
}

/** Read bytes beyond the stored cursor for this file; advance the cursor. */
function readNewBytes(filePath: string): string {
  const offset = fileOffsets.get(filePath) ?? 0;
  let stat: fs.Stats;
  try { stat = fs.statSync(filePath); } catch { return ''; }
  if (stat.size <= offset) return '';
  const newByteCount = stat.size - offset;
  const buf = Buffer.alloc(newByteCount);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, newByteCount, offset);
  } finally {
    fs.closeSync(fd);
  }
  fileOffsets.set(filePath, stat.size);
  return buf.toString('utf8');
}

/** Build an SSE envelope from a parsed JSONL line and its file path. */
function buildEnvelope(line: Record<string, unknown>, filePath: string): SseEnvelope {
  const { source, pathAgentId, pathSessionId } = parseFilePath(filePath);

  const rawTs = line['timestamp'] ?? line['ts'];
  const ts =
    typeof rawTs === 'string' ? rawTs :
    typeof rawTs === 'number' ? new Date(rawTs).toISOString() :
    new Date().toISOString();

  let agentId: string | null;
  let sessionId: string | null;
  if (source === 'cron_run') {
    agentId = typeof line['jobId'] === 'string' ? line['jobId'] : pathAgentId;
    sessionId = typeof line['sessionId'] === 'string' ? line['sessionId'] : null;
  } else {
    agentId = pathAgentId;
    sessionId = pathSessionId;
  }

  const type =
    typeof line['type'] === 'string' ? line['type'] :
    typeof line['action'] === 'string' ? line['action'] :
    'unknown';

  return { ts, source, agentId, sessionId, type, raw: line };
}

/** Write an SSE envelope to all connected clients; remove dead connections. */
function emitToClients(envelope: SseEnvelope): void {
  const data = `data: ${JSON.stringify(envelope)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}

/** Start chokidar watcher for cron run and session JSONL files. */
function startWatcher(): void {
  const globs = [
    `${OPENCLAW_DATA_DIR}/cron/runs/*.jsonl`,
    `${OPENCLAW_DATA_DIR}/agents/*/sessions/*.jsonl`,
  ];

  // usePolling: inotify events are unreliable on Docker-managed mounts and some
  // Linux VPS filesystems. Polling checks for changes every 1 s — slightly more
  // CPU than inotify but guaranteed to work on any filesystem.
  const watcher = chokidar.watch(globs, {
    persistent: true,
    ignoreInitial: false,
    usePolling: true,
    interval: 1000,
  });

  // Track whether the initial directory scan has finished.
  // Files added BEFORE ready are pre-existing — skip their history.
  // Files added AFTER ready are newly created at runtime — read them immediately.
  let watcherReady = false;
  watcher.on('ready', () => { watcherReady = true; });

  watcher.on('add', (filePath: string) => {
    console.log(`[host-agent] watcher add: ${filePath} (ready=${watcherReady})`);
    if (!watcherReady) {
      // Startup scan — set cursor to end so we don't replay existing history.
      try {
        const stat = fs.statSync(filePath);
        fileOffsets.set(filePath, stat.size);
        console.log(`[host-agent] startup file offset set to ${stat.size}: ${filePath}`);
      } catch {
        fileOffsets.set(filePath, 0);
      }
      return;
    }

    // New file created at runtime (e.g. first run of a cron job).
    // Start from byte 0 and emit any content already written.
    fileOffsets.set(filePath, 0);
    const text = readNewBytes(filePath);
    if (!text) return;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        console.error('[host-agent] unparseable JSONL line in', filePath);
        continue;
      }
      emitToClients(buildEnvelope(obj, filePath));
    }
  });

  watcher.on('change', (filePath: string) => {
    console.log(`[host-agent] watcher change: ${filePath}`);
    const text = readNewBytes(filePath);
    console.log(`[host-agent] new bytes read: ${text.length} chars from ${filePath}`);
    if (!text) return;
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        console.error('[host-agent] unparseable JSONL line in', filePath);
        continue;
      }
      emitToClients(buildEnvelope(obj, filePath));
    }
  });

  watcher.on('error', (err: unknown) => {
    console.error('[host-agent] watcher error:', err);
  });

  console.log(`[host-agent] watching JSONL files under ${OPENCLAW_DATA_DIR}`);
}

/** Send a heartbeat ping to all SSE clients every 30s. */
setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(': ping\n\n');
    } catch {
      sseClients.delete(res);
    }
  }
}, 30_000);

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  // Only accept connections from localhost or Docker bridge networks
  const remoteAddr = req.socket.remoteAddress ?? '';
  if (!isAllowedIp(remoteAddr)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  const url = req.url ?? '/';

  if (req.method === 'GET' && url === '/events') {
    if (!requireBearerAuth(req)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(': connected\n\n');
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });

    return;
  }

  if (req.method === 'GET' && url === '/metrics') {
    const [disk, network] = await Promise.all([getDiskStats(), getNetworkDelta()]);
    sendJson(res, 200, {
      cpu_pct: parseCpuPercent(),
      memory: parseMemory(),
      disk,
      network,
      loadavg: parseLoadAvg(),
      uptime_seconds: parseUptime(),
      sampled_at: Date.now(),
    });
    return;
  }

  if (req.method === 'GET' && url === '/docker') {
    const containers = await getDockerStats();
    sendJson(res, 200, { containers });
    return;
  }

  if (req.method === 'GET' && url === '/services') {
    const services = await getServiceStatus();
    sendJson(res, 200, services);
    return;
  }

  if (req.method === 'POST' && url === '/docker/restart') {
    if (!requireBearerAuth(req)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' });
        return;
      }

      const container = (parsed as Record<string, unknown>)['container'];
      if (typeof container !== 'string' || !ALLOWED_CONTAINERS.has(container)) {
        sendJson(res, 400, { error: 'Unknown container' });
        return;
      }

      // execFile with hardcoded command and validated container name from whitelist
      execFile('docker', ['restart', container], { timeout: 30000 }, (err) => {
        if (err) {
          sendJson(res, 500, { error: 'Restart failed', detail: err.message });
        } else {
          sendJson(res, 200, { ok: true, container });
        }
      });
    });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, BIND_ADDRESS, () => {
  console.log(`[host-agent] listening on ${BIND_ADDRESS}:${PORT}`);
  if (ALLOWED_CONTAINERS.size === 0) {
    console.warn('[host-agent] ALLOWED_RESTART_CONTAINERS is not set — docker restart endpoint will reject all requests');
  }
  startWatcher();
});
