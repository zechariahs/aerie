```
            /\
           /  \
  >       /    \       AERIE
         / ──── \
        /        \
        ──────────
```

<div align="center">

**A self-hosted mission control dashboard for OpenClaw agents.**

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38BDF8?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)

</div>

---

Aerie runs as a Docker Compose sidecar alongside an existing OpenClaw stack. It provides
real-time agent monitoring, cron management, cost tracking, task dispatching, and a
Claude integration loop — all behind TOTP-protected authentication, with no cloud
dependency and no telemetry.

---

## Screenshots

<!-- TODO: add screenshots once deployed -->
> _Screenshots coming soon. Pull requests with screenshots welcome._

---

## Design Language — Phosphor Terminal

Aerie's visual identity is built around a single idea: **a phosphor monitor from 1985 running
software from the future.**

Every interface element references the warm amber glow of a P3 phosphor tube — the kind
that lit up control rooms and trading floors before LCD displaced them. The palette is
deliberately narrow:

| Token | Hex | Usage |
|---|---|---|
| Phosphor Amber | `#C8890A` | Primary text, active states, highlights |
| Amber Dim | `#8A5F07` | Secondary text, inactive labels |
| Amber Glow | `#E8A020` | Hover states, focus rings |
| Near-Black | `#0A0A08` | Primary background |
| Surface | `#111110` | Card and panel backgrounds |
| Border | `#1E1E1A` | Dividers, input borders |
| Destructive | `#B03A2E` | Error states, failure indicators |

**Typography** is IBM Plex Mono throughout — no sans-serif, no variable weights. The
monospace constraint isn't decorative; it makes status grids, token counts, and cron
schedules feel native to the data they're presenting.

**Interaction design** follows the same philosophy: no animations for their own sake, no
rounded pills, no gradient fills. State changes communicate through brightness and color
shift, not motion. An active cron job looks different from an idle one because amber
reads differently at full brightness than at 40% — the way a phosphor element actually
behaves as it cools.

The logo itself encodes the design language: a dimmed terminal prompt `>` beside an
amber `A` with crossbar and underscore cursor. Operator-first, always in context.

---

## Features

### ◈ Command Center

```
┌─ AGENT STATUS ──────────────────────────────────────┐
│  ● WintermuteTuring          ACTIVE   kimi-k2-0905  │
│    Last session: 4m ago  ·  Today: 3 sessions       │
│    Cost today: $0.031    ·  Tokens: 47,829          │
└─────────────────────────────────────────────────────┘
```

Real-time agent cards pull live state from the OpenClaw Gateway via WebSocket.
An SSE-backed activity feed streams cron events, tool calls, and session lifecycle
events as they occur. The persistent status strip shows gateway health, OpenRouter
credit balance, and current local time — always visible, always live.

### ◈ Cron Manager

```
         MON       TUE       WED       THU       FRI       SAT       SUN
05:00  [heart]   [heart]   [heart]   [heart]   [heart]   [heart]   [heart]
06:00  [reddit]  [reddit]  [reddit]  [reddit]  [reddit]  [reddit]  [reddit]
07:00  [brief]   [ccm──]   [brief]   [brief]   [brief]   [brief]   [brief]
08:00            [rev──]                       [rev──]
17:00                                                               [wkly]
```

Weekly timeline view of all scheduled jobs with run history, duration, token counts,
and status badges. Manual triggers, enable/disable toggling, and schedule editing all
route through the Gateway API. Run history persists to SQLite as Gateway events arrive.

### ◈ Cost & Token Tracking

Per-agent and per-cron spend sourced from the OpenRouter `/api/v1/usage` endpoint,
with a local price table as fallback. Daily spend chart (last 30 days), per-cron
average cost-per-run, and a monthly projection. No Anthropic Console dependency — all
cost data flows through OpenRouter.

### ◈ Task Board

Multi-agent Kanban (Inbox → Assigned → In Progress → Clarification → Review → Done)
backed by local SQLite. Tasks carry a **capability tier** — not a specific model name —
that agents map to a model at execution time. A `task-executor` cron polls the board
every 15 minutes and works the queue by priority and due date. Clarification questions
park in the board or route to Telegram based on time of day.

| Tier | Intended use |
|---|---|
| `fast` | Triage, classification, quick lookups |
| `default` | Most tasks |
| `reasoning` | Complex research, multi-step plans |
| `auto` | Agent reads the description and decides |

### ◈ Claude Integration Loop

A brief editor for composing SESSION-STATE.md updates — the structured handoff document
shared with Claude at the start of each review session. Surfaces workspace state, recent
cron run history, and open issues in a single pasteable block.

### ◈ Workspace Browser

Read-only file browser over the OpenClaw workspace mount. JSON is prettified, Markdown
is rendered, plain text is displayed verbatim. Scratch outputs and deliverables are
accessible without SSH.

### ◈ VPS Health

Live CPU, RAM, disk, and network metrics from the host agent process (reads `/proc`
directly on the VPS host). Per-container Docker status. 30-second polling interval.

### ◈ Audit Log

Every write operation is recorded to SQLite with action, resource, result, IP, and user
agent. No write completes without a corresponding audit entry.

---

## Architecture

```
Browser
  │  HTTPS → Nginx reverse proxy
  ▼
Aerie  (Next.js 15, Docker sidecar, 127.0.0.1:3100)
  ├── /api/gateway/ws   → WebSocket bridge → OpenClaw Gateway
  ├── /api/events       → SSE activity feed
  ├── /api/crons/*      → Cron read/trigger via Gateway API
  ├── /api/costs/*      → OpenRouter API + local price table
  ├── /api/tasks/*      → SQLite (tasks, audit log)
  ├── /api/workspace/*  → Filesystem reads from /openclaw (read-only)
  ├── /api/agents/*     → Agent list from openclaw.json + Gateway state
  ├── /api/vps/*        → Proxy to host agent (:3101)
  └── /api/auth/*       → Login, TOTP, session JWT

Host agent  (Node.js systemd service, 127.0.0.1:3101)
  ├── /proc reads       → CPU, RAM, disk, network
  ├── docker events     → Container status
  └── chokidar          → JSONL file watcher → SQLite cron_runs
```

**Hard constraints baked into the design:**

- `/openclaw` mount is read-only at the Docker level. Aerie never writes to it.
- No `localStorage` or `sessionStorage` anywhere in the codebase — React state or
  server-side session only.
- All write API routes require a valid TOTP token in addition to the session cookie.
- The OpenClaw Gateway WebSocket is proxied server-side. It is never exposed directly
  to the browser.
- Gateway auth uses `client: { id: 'webchat', mode: 'webchat' }` with an `Origin`
  header — the Gateway enforces this as an enum; other `client.id` values are rejected.
- `execFile` with an args array for all shell invocations — no string interpolation.

---

## Installation

### Prerequisites

- VPS running the OpenClaw stack
- Docker Engine + Compose plugin
- Node.js 22+ on the VPS host
- pnpm (for credential generation)
- An OpenRouter API key

### 1 — Generate credentials (local machine)

```bash
git clone https://github.com/zechariahs/aerie.git
cd aerie/app
pnpm install

pnpm exec tsx scripts/gen-totp.ts        # → MC_TOTP_SECRET + QR code for authenticator
pnpm exec tsx scripts/hash-password.ts <password>  # → MC_ADMIN_PASSWORD_HASH
```

Save both outputs — they are not shown again.

### 2 — Clone and configure on the VPS

```bash
sudo mkdir -p /docker/aerie
sudo chown $USER:$USER /docker/aerie
git clone https://github.com/zechariahs/aerie.git /docker/aerie
cp /docker/aerie/env.example /docker/aerie/app/.env.production
```

Fill in `app/.env.production`. Critical values:

```env
# Gateway — proxy port, not the direct gateway port
OPENCLAW_GATEWAY_URL=ws://<openclaw-container-name>:<proxy-port>
OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1

# Auth — MC_ADMIN_PASSWORD_HASH must live here, not in root .env
# (Docker Compose interpolation mangles $ characters in Argon2 hashes)
MC_ADMIN_PASSWORD_HASH=<argon2 hash>
MC_ADMIN_PASSWORD_HASH_B64=<base64 of the hash>
MC_TOTP_SECRET=<totp secret>

# Cost tracking
OPENROUTER_API_KEY=<your key>

# Agent → Aerie calls (aerie-task skill)
AGENT_API_KEY=<random string>
AERIE_INTERNAL_URL=http://aerie:3100/aerie

# Google Drive (optional — degrades gracefully if unset)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
```

Also create `/docker/aerie/.env`:

```env
OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1
OPENCLAW_DATA_PATH=/path/to/openclaw/data
OPENCLAW_NETWORK_NAME=<your openclaw docker network>
```

### 3 — Deploy the host agent

The host agent runs on the VPS host (not in Docker) and provides `/proc`-based
metrics and JSONL file watching.

```bash
cd /docker/aerie/host-agent
npm install
sudo cp aerie-host-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aerie-host-agent
```

### 4 — Build and start

```bash
cd /docker/aerie
sudo docker compose -f docker-compose.sidecar.yml up -d --build
sudo docker logs aerie --tail 30
```

A healthy start logs `[gateway-bridge] authenticated as operator`. `ECONNREFUSED`
or WebSocket `1008` errors indicate a misconfigured `OPENCLAW_GATEWAY_URL` or
missing `OPENCLAW_ALLOW_INSECURE_PRIVATE_WS`.

### 5 — Configure Nginx

```bash
sudo ln -s /etc/nginx/sites-available/aerie /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

The Nginx config requires separate `location` blocks for the SSE endpoint
(`/api/events` — `proxy_buffering off`) and the WebSocket bridge
(`/api/gateway/ws` — `Upgrade` header passthrough).

### 6 — Verify

```bash
curl https://<your-domain>/aerie/api/health
# → {"ok":true,"gateway":"connected", ...}
```

---

## Rebuild after changes

```bash
cd /docker/aerie
sudo docker compose -f docker-compose.sidecar.yml up -d --build
```

`NEXT_PUBLIC_*` variables and `basePath` are baked at build time, not injected at
runtime. Always use `--build`. If the build appears to use stale output, delete
`.next/` before rebuilding.

---

## Agent integration (aerie-task skill)

The `aerie-task` skill allows OpenClaw agents to create tasks on the board
via the `/task` command or natural language. Middleware bypasses Bearer token
requests to `/api/` routes; route handlers validate the token. `AGENT_API_KEY`
is inlined in the skill definition and must never be committed to source control.

---

## Known Issues

| Area | Issue |
|---|---|
| Agents screen | 7 API routes invoke `openclaw` binary directly — fix requires host agent proxy endpoints |
| SESSION-STATE.md write | `/openclaw` is read-only; `brief.ts` write path needs to target a writable location |
| `weekly-research-digest` | Intermittent timeout errors; root cause unresolved |
| Agent Management screen | Spec complete (`SPEC-agent-management.md`), not yet implemented |
| SSE frontend | Pipeline populated, frontend rendering issue open |
| `.next` in `.gitignore` | `.next/` should be gitignored |

---

## For developers

See `CLAUDE.md` (kept local, not in repo) for the full architecture reference, security
constraints, session protocols, and contribution rules.

Key rules that are frequently violated in this codebase:

- Commit directly to `main` — no working branches
- No `localStorage` or `sessionStorage` anywhere
- All write routes require TOTP validation before business logic
- `/openclaw` mount is read-only — the only sanctioned write path is via the whitelisted endpoint
- `execFile` with an args array for all shell commands — never string interpolation into `exec`
- Copyright header on every new source file (see `CLAUDE.md`)