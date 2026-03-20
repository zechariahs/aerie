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

function getDiskStats(): Promise<Array<{ mount: string; used: string; available: string; use_pct: string }>> {
  return new Promise((resolve) => {
    // execFile with hardcoded args — no user input interpolation
    execFile('df', ['-h', '--output=target,used,avail,pcent'], { timeout: 3000 }, (_err, stdout) => {
      const lines = stdout.trim().split('\n').slice(1);
      const result = lines.map((line) => {
        const [mount = '', used = '', available = '', use_pct = ''] = line.trim().split(/\s+/);
        return { mount, used, available, use_pct };
      });
      resolve(result);
    });
  });
}

function getDockerStats(): Promise<Array<{ name: string; status: string; cpu_pct: number; mem_mb: number }>> {
  return new Promise((resolve) => {
    // execFile with hardcoded args — no user input interpolation
    execFile(
      'docker',
      ['stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'],
      { timeout: 10000 },
      (_err, stdout) => {
        const lines = stdout.trim().split('\n').filter(Boolean);
        const result = lines.map((line) => {
          const [name = '', cpu = '0%', mem = '0MiB'] = line.split('\t');
          const cpu_pct = parseFloat(cpu.replace('%', '')) || 0;
          const mem_mb = parseFloat(mem.split('/')[0]?.replace(/[^0-9.]/g, '') ?? '0') || 0;
          return { name, status: 'running', cpu_pct, mem_mb };
        });
        resolve(result);
      },
    );
  });
}

function getServiceStatus(): Promise<{ nginx: string }> {
  return new Promise((resolve) => {
    execFile('systemctl', ['is-active', 'nginx'], { timeout: 3000 }, (_err, stdout) => {
      resolve({ nginx: stdout.trim() });
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
    const [disk] = await Promise.all([getDiskStats()]);
    sendJson(res, 200, {
      cpu_pct: parseCpuPercent(),
      memory: parseMemory(),
      disk,
      loadavg: parseLoadAvg(),
      uptime_seconds: parseUptime(),
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
