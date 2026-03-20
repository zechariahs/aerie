// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT
//
// Mission Control Host Agent — runs on the VPS HOST (not inside Docker).
// Reads /proc/* and docker stats, exposes a single JSON HTTP API on 127.0.0.1:3101.
// Mission Control proxies to this; it is never exposed directly to the internet.
//
// Start: node dist/index.js (after tsc build) or tsx index.ts for dev

import http from 'http';
import { execFile } from 'child_process';
import fs from 'fs';

const PORT = parseInt(process.env['HOST_AGENT_PORT'] ?? '3101', 10);
const HOST_AGENT_TOKEN = process.env['HOST_AGENT_TOKEN'];

// Whitelist of exact commands allowed for docker restart.
// User input must exactly match the container name — no interpolation.
const ALLOWED_CONTAINERS = new Set(['openclaw-v5t3-openclaw-1', 'mc-wintermute']);

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
  return new Promise((resolve) => {
    execFile('systemctl', ['is-active', 'nginx'], { timeout: 3000 }, (_err, stdout) => {
      const nginx = stdout.trim();
      // Check if the openclaw container is running by filtering docker ps output
      execFile(
        'docker',
        ['ps', '--filter', 'name=openclaw-v5t3-openclaw-1', '--format', '{{.Names}}'],
        { timeout: 5000 },
        (_dockerErr, dockerStdout) => {
          resolve({ nginx, openclaw_gateway: dockerStdout.trim().length > 0 });
        },
      );
    });
  });
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

const server = http.createServer(async (req, res) => {
  // Only accept connections from localhost
  const remoteAddr = req.socket.remoteAddress ?? '';
  if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  const url = req.url ?? '/';

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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[host-agent] listening on 127.0.0.1:${PORT}`);
});
