# WintermuteTuring Mission Control — Feature Specification

Version: 1.0  
Status: Approved  
Owner: Zack Schwenk / Schwenk Technology Group

---

## Design Principles

- **Multi-agent from day one** — single agent now, N-agent ready. No structural
  refactoring required when a second agent is added.
- **Provider agnostic** — no Anthropic-specific cost APIs. All token/cost data
  from OpenClaw SQLite + OpenRouter API + a local price table.
- **VPS-resident** — Docker Compose sidecar. Nginx reverse proxy. Never local-only.
- **Gateway-read + filesystem-read hybrid** — WebSocket to Gateway for live
  events; direct filesystem access for cron outputs, workspace files, memory.
- **Claude as a first-class participant** — the dashboard is a structured
  integration point in the operational loop, not a chat widget bolted on.

---

## Module 1 — Command Center (Home / `/`)

### Live Status Strip (persistent top bar, all pages)
- Per-agent status dot: ACTIVE / IDLE / ERROR / OFFLINE
  - Source: Gateway WebSocket heartbeat events
  - Color: green / gray / red / dark-gray
- Gateway health indicator (connected / disconnected / reconnecting)
- OpenRouter credit balance — polled every 15 min via `/api/v1/auth/key`
- Current time in America/Chicago (digital clock, updates every second)
- Unread notification badge (links to notification panel)

### Agent Cards Grid
- One card per agent, auto-discovered from `openclaw.json` on startup
- Card contents:
  - Agent emoji + name + ID
  - Current model (primary)
  - Status badge (ACTIVE / IDLE / ERROR)
  - Last active timestamp (relative: "3 min ago")
  - Session count today
  - Cost today (USD, from cost module)
  - Quick actions: "New Task" (→ Task Board pre-filled), "View Sessions"
- Layout: CSS grid, 1 col mobile / 2 col tablet / 3+ col desktop
- Scales to N agents without layout changes
- Per-agent color accent sourced from `openclaw.json` `ui.color` field;
  defaults to a hash of the agent ID if not set

### Activity Feed
- Real-time event stream via SSE (`/api/events`)
- Events sourced from Gateway WebSocket, transformed server-side, broadcast via SSE
- Event types displayed:
  - `cron.start` / `cron.end` / `cron.error`
  - `session.start` / `session.end`
  - `tool.call` (tool name, agent, duration)
  - `message.sent` (channel, truncated content)
  - `error` (agent, message)
- Filter bar: by agent ID, by event type, by time range (last 1h / 6h / 24h / 7d)
- Token velocity indicator: rolling 5-min average tokens/min per agent;
  shows warning badge if > 2σ above that agent's 7-day baseline
- "Hide sensitive content" toggle: replaces project names and task titles
  with `[REDACTED]` in the feed. State persists in session cookie.
- Virtual scroll — feed does not paginate, renders only visible rows

---

## Module 2 — Cron Manager (`/crons`)

### Weekly Timeline View
- 7-column grid (Mon–Sun), horizontal time axis (0h–24h)
- Each cron job plotted as a pill at its scheduled UTC time, converted to
  America/Chicago for display
- Pill color = agent color; pill label = cron name
- Hover → tooltip showing: next run time, last run status, last run duration
- Click pill → opens run history drawer (see below)
- "This week" is default; prev/next week navigation

### Per-Job Panel (below timeline, selected job)
- Cron name, ID, schedule (cron expression + human-readable)
- Assigned agent
- Model override (if set)
- Status: ACTIVE / DISABLED / RUNNING
- Controls:
  - **Manual Trigger** button — calls `POST /api/crons/[id]/trigger`
    which shells `openclaw cron run <id>` via Gateway. Requires TOTP.
    Shows spinner while running; updates status on completion.
  - **Enable / Disable** toggle. Requires TOTP.
  - **Edit Schedule** — inline cron expression editor with human-readable
    preview (e.g., "Every Monday at 7:00 AM CT"). Requires TOTP.

### Run History Drawer
- Last 20 runs for the selected cron
- Per-run row: timestamp, status (SUCCESS/FAILED/RUNNING), duration, tokens used
- Click row → expands to show:
  - Truncated Telegram delivery message (if captured)
  - Output file path (if written to scratch/ or Drive)
  - Link to file in workspace browser (if local) or Drive link (if Drive)
  - Error message (if failed)

### Output Viewer
- If a cron's last run wrote to `scratch/`, surface the file inline:
  - Markdown → rendered HTML
  - JSON → prettified with syntax highlighting
  - Other → raw text
- Drive link shown if output was written to Google Drive (parsed from delivery log)

---

## Module 3 — Cost & Token Tracking (`/costs`)

### Data Sources (in priority order)
1. OpenRouter `/api/v1/usage` — per-model, per-day cost keyed to API key
2. OpenClaw SQLite sessions DB — token counts per session, per agent
3. Local price table (model ID → $/1M input tokens, $/1M output tokens)
   stored in `/app/data/price-table.json`, editable via UI

All cost computations use source (1) when available; fall back to (2)+(3).
Display a small badge indicating which source was used.

### Views

**Daily Spend Chart**
- Bar chart, last 30 days
- Stacked by model (each model = distinct color)
- Hover → tooltip with per-model breakdown for that day
- Total spend annotation on each bar

**Per-Agent Cost Panel**
- One row per agent
- Columns: agent name, cost today, cost this week, cost this month,
  avg cost/session, total sessions
- Sparkline (7-day trend) in the cost-this-week cell
- Click row → drills down to that agent's session list

**Per-Cron Cost Panel**
- One row per cron job
- Columns: cron name, avg tokens/run (last 10), avg cost/run (last 10),
  total cost this month, runs this month
- Sorted by total cost this month descending

**Session Cost Inspector**
- Paginated table of all sessions, newest first
- Columns: timestamp, agent, model, input tokens, output tokens, cost,
  duration, status
- Sortable by all columns
- Outlier highlighting: sessions > 2σ above agent's mean cost shown in amber
- Search/filter by agent, model, date range

**Token Velocity Alert Configuration**
- Set per-agent threshold (tokens/min)
- When exceeded: banner at top of dashboard + entry in notification center
- Default threshold: 500 tokens/min (configurable)

**Monthly Projection**
- Linear extrapolation from current month's daily average
- Shows: current month spend, projected month-end total, vs. last month

**Price Table Editor**
- Table of model ID → input price, output price ($/1M tokens)
- Pre-populated with known OpenRouter models
- "Add model" row for new entries
- Changes saved to `/app/data/price-table.json`. Requires TOTP.

---

## Module 4 — Task Board (`/tasks`)

### Layout
- Kanban board: **Inbox → Assigned → In Progress → Review → Done → Archived**
- Each column scrollable independently
- Column header shows count + total estimated cost (if set)
- Drag-and-drop between columns (requires TOTP confirmation on drop)

### Task Card
- Title (required)
- Description (markdown, optional)
- Assigned agent (dropdown, populated from openclaw.json)
- Priority: P1 / P2 / P3 / P4 (color-coded dot)
- Tag: STG / Personal / CW (mirrors workspace folder structure)
- Created timestamp, last updated timestamp
- Linked output: Drive URL or local file path (populated when agent delivers)
- Task ID (auto-generated, shown in card footer)

### Task Creation
- "New Task" button → slide-over panel with form
- Fields: title, description, agent, priority, tag, due date (optional)
- On save:
  - Persists to local SQLite (`mc.db`, `tasks` table)
  - **"Send to Agent via Telegram"** button: formats task as a structured
    message and POSTs to Telegram delivery UID `1619919639` via
    `/api/gateway/message`. Requires TOTP.
  - **"Write to Task-Specs/ in Drive"** button: creates a native Google Doc
    in the `Task-Specs/` folder with standardized task brief format.
    Requires TOTP.

### Task Detail Panel (click any card)
- Full description rendered as markdown
- Status history (timeline of column moves)
- Linked output viewer (if Drive doc: iframe preview; if local: inline render)
- Comments field (stored in SQLite, not synced anywhere)
- "Mark Done" quick action
- "Archive" action (moves to Archived column, hidden by default)

### Task-Specs/ Inbox (sub-panel within Tasks page)
- Polls `Task-Specs/` Google Drive folder every 5 minutes
- Lists unprocessed task spec docs (identified by absence of a matching
  task ID in local SQLite)
- "Import as Task" button → creates a task card pre-populated from the doc
- Allows Claude to queue work for Wintermute asynchronously

---

## Module 5 — Claude Integration Loop (`/claude-loop`)

This module is the primary differentiator. It operationalizes the handoff
between Wintermute's async outputs and Claude (claude.ai) interactive sessions.

### Claude Brief Generator

**Purpose:** Assemble a structured context document so a Claude session can
begin with full operational awareness of Wintermute without manual copy-paste.

**Brief contents (auto-assembled):**
```
## Wintermute Operational Brief — [date]

### Agent Status
[per-agent: status, last active, model, cost today]

### Cron Summary (last 7 days)
[per-cron: last run date, status, output excerpt if available]

### Cost Summary
[spend last 7 days, vs. prior 7 days, projection to month-end]

### Open Tasks
[tasks in Review column, with linked output URLs]

### Recent Errors
[any ERROR events from activity feed in last 24h]

### Pending Items from SESSION-STATE.md
[extracted from /openclaw/workspace/SESSION-STATE.md]

### Notes
[free-text field, manually entered before generating]
```

**Controls:**
- "Notes" textarea — add context before generating
- "Generate Brief" button (requires TOTP):
  1. Assembles brief from live data
  2. Writes as native Google Doc to `MC-Briefs/` folder
  3. Shows "Open in Drive" link
  4. Copies Drive share URL to clipboard

**Brief History:**
- Table of all generated briefs (date, title, Drive link)
- Last 30 briefs retained

### SESSION-STATE.md Editor
- Inline Monaco-lite editor (use CodeMirror, no Monaco — too heavy) for
  `/openclaw/workspace/SESSION-STATE.md`
- Read from /openclaw mount; writes go via `/api/workspace/write` endpoint
  (the only write path to the workspace — TOTP required, path whitelist
  enforced server-side to SESSION-STATE.md only)
- "Export for Claude" button: copies file contents to clipboard with a
  prepended instruction block:
  ```
  The following is the current operational state of WintermuteTuring.
  Use this as context for this session.
  ---
  [file contents]
  ```
- "Sync from Dashboard" button: regenerates SESSION-STATE.md content from
  live dashboard data (same content as Brief, in SESSION-STATE format)

### Deliverables Browser
- File tree of `deliverables/STG/`, `deliverables/Personal/`, `scratch/`
  from /openclaw mount
- Click file → inline preview (markdown rendered, JSON prettified)
- "Share with Claude" button → adds file path to the next Brief draft
- "Open in Drive" button → visible if file has a matching Drive doc
  (matched by filename pattern in the Drive folder)

### Task-Specs/ Writer
- Textarea + "Write to Drive" button
- Writes a native Google Doc to `Task-Specs/` in the structured task brief
  format that Wintermute understands
- Used when you want Claude to draft a task spec mid-session for later
  Wintermute execution

---

## Module 6 — Workspace & Memory (`/workspace`)

### File Browser
- Full tree of `/openclaw/workspace/` (read-only mount)
- Expandable/collapsable directories
- File preview on click:
  - `.md` → rendered markdown
  - `.json` → prettified JSON with syntax highlighting
  - `.txt` → plain text
  - Other → "binary file, cannot preview"
- Special handling for known files:
  - `SOUL.md`, `MEMORY.md`, `IDENTITY.md`, `TOOLS.md`, `AGENTS.md`,
    `SESSION-STATE.md`, `heartbeat-state.json` → pinned to top of tree

### Memory Browser
- Dedicated view for `MEMORY.md` and all `.md` files under `workspace/`
- Editable via SESSION-STATE.md editor pattern (whitelist enforced)
- For `SESSION-STATE.md` only — other files are read-only in the UI

### Global Search
- Full-text search across all files in `/openclaw/workspace/`
- Debounced input, results show file path + matching line with highlight
- Click result → opens file browser at that file, scrolls to match

### Heartbeat State
- Dedicated panel for `heartbeat-state.json`
- Key/value table display (not raw JSON)
- Last updated timestamp prominent
- "Stale" warning if last heartbeat > 6 hours ago

### Read-Only Terminal
- Whitelisted commands only, executed server-side via child_process:
  ```
  openclaw cron list
  openclaw cron runs --id <id>   (id must match known cron IDs)
  df -h
  free -m
  uptime
  ```
- Output displayed in a monospace panel, not a real TTY
- No arbitrary command execution. Whitelist is hardcoded, not configurable.

---

## Module 7 — VPS Health (`/vps-health`)

Data source: host agent running on the VPS host at `HOST_AGENT_URL` (:3101).
The host agent is a separate minimal Node.js process (not in Docker) that
reads `/proc/` and exposes a single JSON endpoint. See host-agent spec below.

### Metrics Panel
- CPU usage % (gauge + sparkline, 5-min history)
- RAM usage (used / total, gauge + sparkline)
- Disk usage (used / total / available, per mount point)
- Network I/O (bytes in/out per second, sparkline)
- Load average (1m / 5m / 15m)

### Docker Panel
- Container list from `docker stats` (parsed by host agent)
- Per-container: name, status, CPU %, memory usage, uptime
- `openclaw-v5t3-openclaw-1` highlighted as primary container
- `mc-wintermute` (this dashboard) also listed
- Restart button for openclaw container (requires TOTP, calls docker restart
  via host agent endpoint)

### Uptime & Service Status
- System uptime
- Nginx status (host agent checks `systemctl is-active nginx`)
- OpenClaw gateway status (derived from WebSocket connection state)

### Host Agent Spec
File: `/mission-control-host-agent/index.ts`

```typescript
// Endpoints:
GET /metrics  → { cpu, memory, disk, network, loadavg, uptime }
GET /docker   → { containers: [{ name, status, cpu_pct, mem_mb, uptime }] }
GET /services → { nginx: 'active'|'inactive', openclaw_gateway: boolean }
POST /docker/restart  → body: { container: string }  (auth token required)
```

The host agent reads its auth token from an environment variable
`HOST_AGENT_TOKEN`. Mission Control sends this token as a Bearer header.
The token must match a value also set in Mission Control's environment as
`HOST_AGENT_TOKEN`. This is the only write-capable endpoint on the host agent.

---

## Module 8 — Security

### Authentication
- Single admin user (no multi-user support)
- Password: argon2id hash stored in environment variable `MC_ADMIN_PASSWORD_HASH`
- Session: HttpOnly cookie, signed with `AUTH_SECRET`, 8-hour expiry
- Rate limiting on login: 5 attempts per 15 minutes per IP

### TOTP MFA
- TOTP secret stored in `MC_TOTP_SECRET` environment variable (base32)
- QR code shown once at first login; after that, TOTP entry required for all
  write operations
- TOTP token submitted as `X-TOTP-Token` request header on write API calls
- Server validates token server-side; never passes token to client
- Grace window: ±1 interval (30-second tokens, so 90-second grace)

### Write Operations Requiring TOTP
Every API route that mutates state must validate TOTP before executing:
- `POST /api/crons/[id]/trigger`
- `PUT /api/crons/[id]` (enable/disable/edit)
- `POST /api/tasks` / `PUT /api/tasks/[id]` / `DELETE /api/tasks/[id]`
- `POST /api/gateway/message` (send to Telegram)
- `POST /api/drive/write` (write to Google Drive)
- `PUT /api/workspace/session-state` (edit SESSION-STATE.md)
- `POST /api/drive/brief` (generate and write Claude Brief)
- `POST /api/host-agent/docker/restart`

### Network
- Mission Control binds to `127.0.0.1:3100` only
- All external access via Nginx reverse proxy
- `MC_ALLOWED_HOSTS` env var enforces host header validation
- No CORS headers set — same-origin only
- Content Security Policy: strict-dynamic nonces, no unsafe-inline

### Audit Log
- SQLite table `audit_log` in `mc.db`
- Schema: `(id, timestamp, action, resource, result, ip, user_agent)`
- All write operations logged regardless of success/failure
- Surfaced in read-only panel at `/security/audit`
- Retained indefinitely (small table — write ops are infrequent)

---

## Deployment Configuration

### Docker Compose (sidecar, append to existing stack)

```yaml
# docker-compose.sidecar.yml
services:
  mission-control:
    build:
      context: ./mission-control
      dockerfile: Dockerfile
    container_name: mc-wintermute
    restart: unless-stopped
    ports:
      - "127.0.0.1:3100:3100"
    volumes:
      - /docker/openclaw-v5t3/data/.openclaw:/openclaw:ro
      - mc_data:/app/data
    env_file:
      - ./mission-control/.env.production
    networks:
      - openclaw-v5t3_default
    depends_on:
      - openclaw-v5t3-openclaw-1

volumes:
  mc_data:

networks:
  openclaw-v5t3_default:
    external: true
```

### Nginx Vhost

```nginx
# /etc/nginx/sites-available/mission-control
server {
    listen 127.0.0.1:60340;
    server_name srv1398517.hstgr.cloud;

    # SSE: disable buffering
    location /api/events {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
    }

    # WebSocket bridge
    location /api/gateway/ws {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    # Everything else
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Future Modules (not in scope for v1, documented for reference)

- **Agent provisioning UI** — create/configure new agents from the dashboard
- **GOG integration** — when GOG skill replaces Maton google-drive, update
  Drive write paths accordingly
- **Multi-channel delivery** — beyond Telegram (Phase 4+ concern)
- **Skill manager** — browse/install/audit ClawHub skills
- **Phase 4 security panel** — SSH key management, fail2ban status

---

## Acceptance Criteria (v1 complete when all pass)

- [ ] Login page loads; password + TOTP auth flow works end-to-end
- [ ] All 6 crons visible in timeline; manual trigger fires successfully
- [ ] Cost charts render with real OpenRouter data
- [ ] Task card created, persists across reload, can be sent to Telegram
- [ ] Claude Brief generated and written to Drive as native Google Doc
- [ ] SESSION-STATE.md editable and exportable from UI
- [ ] VPS metrics panel shows live CPU/RAM/disk
- [ ] Agent cards update in real time when Wintermute runs a session
- [ ] `pnpm typecheck && pnpm lint` pass with zero errors
- [ ] All write operations require TOTP
- [ ] One module failing does not crash others (error boundaries)
- [ ] Docker Compose stack starts cleanly from `docker compose -f docker-compose.yml -f docker-compose.sidecar.yml up -d`
