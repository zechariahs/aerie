# host-agent

A minimal Node.js HTTP server that runs **on the VPS host** (not inside Docker).
It reads `/proc/*` and `docker stats`, exposing system metrics on `127.0.0.1:3101`.
Aerie proxies to it; this service is never reachable from the internet.

---

## Prerequisites

- Node.js 20+ on the VPS host
- `docker` CLI available to the service user
- `systemctl` available (systemd)

---

## Installation

```bash
# Clone the repo and navigate to this directory
cd /opt/host-agent

# Install dependencies
npm install

# Build TypeScript to dist/
npm run build
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HOST_AGENT_PORT` | `3101` | Port to listen on (loopback only) |
| `HOST_AGENT_TOKEN` | _(empty)_ | Bearer token Aerie uses when calling write endpoints. Set to a random string and set the same value as `HOST_AGENT_TOKEN` in Aerie's env. |
| `ALLOWED_RESTART_CONTAINERS` | _(empty)_ | Comma-separated list of container names the agent may restart (e.g. `openclaw-1,aerie`). |

Create `/opt/host-agent/.env` (not committed):

```
HOST_AGENT_PORT=3101
HOST_AGENT_TOKEN=your-random-token-here
ALLOWED_RESTART_CONTAINERS=<openclaw-container-name>,aerie
```

---

## Running with systemd

Copy the service file and enable it:

```bash
sudo cp host-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable host-agent
sudo systemctl start host-agent
sudo systemctl status host-agent
```

View logs:

```bash
journalctl -u host-agent -f
```

---

## API Endpoints

All endpoints bind to `127.0.0.1` only. Non-loopback connections are rejected with `403`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/metrics` | None | CPU, memory, disk, network I/O, load average, uptime |
| `GET` | `/docker` | None | Running container list with CPU %, memory, uptime |
| `GET` | `/services` | None | Nginx and OpenClaw Gateway status |
| `POST` | `/docker/restart` | Bearer | Restart a whitelisted container |

### GET /metrics

```json
{
  "cpu_pct": 12.4,
  "memory": { "used_mb": 1820, "total_mb": 3900 },
  "disk": { "used_bytes": 19327352832, "total_bytes": 85899345920 },
  "network": { "in_bps": 1024, "out_bps": 512 },
  "loadavg": [0.3, 0.25, 0.2],
  "uptime_seconds": 432000,
  "sampled_at": 1742000000000
}
```

### GET /docker

```json
{
  "containers": [
    { "name": "<openclaw-container-name>", "status": "running", "cpu_pct": 2.1, "mem_mb": 412, "uptime_seconds": 430000 }
  ]
}
```

### GET /services

```json
{ "nginx": "active", "openclaw_gateway": true }
```

### POST /docker/restart

Request body:
```json
{ "container": "<openclaw-container-name>" }
```

Requires `Authorization: Bearer <HOST_AGENT_TOKEN>` header.
Only containers in the `ALLOWED_RESTART_CONTAINERS` env var list are accepted.

---

## Development

```bash
# Run with auto-reload (requires tsx)
npm run dev
```

---

## Security Notes

- Binds to `127.0.0.1` only — no external exposure
- All shell commands use `execFile()` with hardcoded args arrays — no user-input interpolation
- Container restart uses a strict allowlist from `ALLOWED_RESTART_CONTAINERS` env var — unknown container names are rejected with `400`
- Bearer token is required for all write endpoints when `HOST_AGENT_TOKEN` is set
