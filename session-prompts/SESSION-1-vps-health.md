# SESSION 1 — Module 7: VPS Health

## Prerequisite
Session 0 complete. Login works. Docker build passes.

## Goal
Implement the VPS Health page (`/vps-health`) with live metrics from the host agent.
Also complete the host agent (`mission-control-host-agent/`) so it can be deployed.

## Scope

### Host Agent (mission-control-host-agent/)
- `index.ts` already scaffolded — review it, fix any issues, add:
  - Network I/O delta (read /proc/net/dev twice, 500ms apart, compute bytes/sec for eth0)
  - `package.json` with: `tsx`, `typescript`, `@types/node`
  - `tsconfig.json` (basic Node, ESNext)
  - `README.md` with: install steps, systemd service unit file, environment variables
  - systemd unit file at `mission-control-host-agent/mission-control-host-agent.service`

### VPS Health Page (`/vps-health/page.tsx`)
Four panels, each wrapped in an error boundary:

**Panel 1 — System Metrics**
Data: `GET /api/vps/metrics` → proxies to `HOST_AGENT_URL/metrics`
Display:
- CPU: gauge (0–100%) + 5-min sparkline (poll every 5s, keep last 60 samples in state)
- RAM: used/total bar + percentage label
- Disk: used/total bar + GB values
- Network: in/out bytes per second (formatted: KB/s, MB/s as appropriate)
- Load average: 1m / 5m / 15m in a row of badges
- Uptime: formatted as "Xd Xh Xm"

**Panel 2 — Docker Containers**
Data: `GET /api/vps/docker` → proxies to `HOST_AGENT_URL/docker`
Display: table with columns: Container Name, Status, CPU %, Memory (MB), Uptime
- Highlight `openclaw-v5t3-openclaw-1` row in brand color
- "Restart" button on openclaw container row (TOTP required, calls `POST /api/vps/restart`)

**Panel 3 — Services**
Data: `GET /api/vps/services` → proxies to `HOST_AGENT_URL/services`
Display: status badges for Nginx, OpenClaw Gateway

**Panel 4 — Unavailable State**
If host agent is unreachable, each panel shows:
"Host agent unavailable — is mission-control-host-agent running on the VPS host?"
with a "Retry" button. Do not show stale data.

### API Routes
- `GET /api/vps/metrics` — fetch from HOST_AGENT_URL, forward response
- `GET /api/vps/docker` — fetch from HOST_AGENT_URL, forward response  
- `GET /api/vps/services` — fetch from HOST_AGENT_URL, forward response
- `POST /api/vps/restart` — TOTP required, forward to HOST_AGENT_URL/docker/restart

All vps API routes: add Bearer auth header with HOST_AGENT_TOKEN when proxying.

## Stopping condition
- `pnpm typecheck && pnpm lint` pass
- `/vps-health` page loads with all 4 panels (even if host agent not running — show unavailable state)
- If `USE_FIXTURES=true`, load fixture data from `fixtures/vps-metrics.json`
- Write SESSION-STATE-MC.md

## Fixture file to create:
`fixtures/vps-metrics.json`:
```json
{
  "metrics": { "cpuPct": 12.4, "memUsedMb": 1820, "memTotalMb": 3900, "diskUsedGb": 18, "diskTotalGb": 80, "networkInBps": 1024, "networkOutBps": 512, "loadAvg1m": 0.3, "loadAvg5m": 0.25, "loadAvg15m": 0.2, "uptimeSeconds": 432000, "sampledAt": 0 },
  "docker": { "containers": [{ "name": "openclaw-v5t3-openclaw-1", "status": "running", "cpuPct": 2.1, "memMb": 412, "uptimeSeconds": 430000 }, { "name": "mc-wintermute", "status": "running", "cpuPct": 0.4, "memMb": 180, "uptimeSeconds": 430000 }] },
  "services": { "nginx": "active", "openclawGateway": true }
}
```
