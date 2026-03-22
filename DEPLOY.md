# Aerie — Deployment Guide

## Prerequisites

- Docker and Docker Compose installed on the VPS
- OpenClaw stack already running (`OPENCLAW_DATA_PATH`, `OPENCLAW_NETWORK_NAME` set)
- `.env.production` populated (see `env.example` for all required variables)
- `pnpm` available on the VPS (or use `npx tsx` as an alternative)

---

## Step 1 — Run the preflight validation suite

From the repo root on the VPS:

```bash
cd app
pnpm install
pnpm exec tsx scripts/preflight.ts
```

The script runs 10 checks and exits 0 (ready) or 1 (failures found):

| # | Check | What it verifies |
|---|-------|-----------------|
| 1 | Env var completeness | All variables in `.env.example` are set in the environment |
| 2 | OpenClaw mount | `$OPENCLAW_DIR/cron/jobs.json` and `workspace/` are readable |
| 3 | SQLite write | `$MC_DATA_DIR/mc.db` accepts INSERT/SELECT/DELETE |
| 4 | Host agent reachability | `GET $HOST_AGENT_URL/metrics` responds 200 |
| 5 | OpenRouter API key | Key accepted by OpenRouter auth endpoint |
| 6 | Google Drive | Service account can list MC-Briefs folder |
| 7 | Docker build | `docker build -t aerie:preflight ./app` exits 0 |
| 8 | Import integrity | No stale `mission-control/` references in `app/src/` |
| 9 | Next.js build | `pnpm build` exits 0 |
| 10 | TOTP clock skew | Local clock within 30s of world time |

**Do not proceed to Step 2 if any check is FAIL.**

WARN results (host agent not yet running, network unreachable) are acceptable for initial deployment. Fix them before going live.

---

## Step 2 — Deploy with Docker Compose

```bash
docker compose \
  -f /path/to/openclaw/docker-compose.yml \
  -f /path/to/aerie/docker-compose.sidecar.yml \
  up -d --build
```

---

## Step 3 — Verify health endpoint

```bash
curl -s http://localhost:3100/api/health | jq .
```

Expected response shape:

```json
{
  "ok": true,
  "version": "1.0",
  "uptime": 42,
  "checks": {
    "db": "ok",
    "openclawMount": "ok",
    "gatewayConnected": true,
    "hostAgentReachable": true,
    "driveConfigured": true,
    "fixtureMode": false
  },
  "errors": []
}
```

The Docker healthcheck (`docker compose ps`) will show `healthy` once `"ok":true` is present in the response.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `openclawMount: missing` | Volume not mounted | Check `OPENCLAW_DATA_PATH` and that OpenClaw is running |
| `gatewayConnected: false` | WebSocket URL wrong or OpenClaw not running | Verify `OPENCLAW_GATEWAY_URL` |
| `hostAgentReachable: false` | host-agent not running on port 3101 | Start `host-agent` service |
| `driveConfigured: false` | Bad base64 or wrong credential type | Re-encode service account JSON |
| Preflight check 1 FAIL | Missing env vars | Copy missing vars from `env.example` into `.env.production` |
