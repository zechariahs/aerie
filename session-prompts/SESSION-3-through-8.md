# SESSION 3 — Module 2: Cron Manager

## Prerequisite
Session 2 complete. Cost page works.

## Goal
Implement the Cron Manager page (`/crons`) with the weekly timeline view,
per-job controls, run history, and the Gateway trigger integration.

## Scope

### Gateway client: `src/lib/gateway.ts` (create this file)
```typescript
// Minimal Gateway API client
// All calls go through the WebSocket bridge at /api/gateway/ws
// For cron operations, use HTTP-style RPC calls via the Gateway

async function triggerCron(cronId: string): Promise<{ ok: boolean; error?: string }>
async function enableCron(cronId: string, enabled: boolean): Promise<{ ok: boolean }>
async function getCronRuns(cronId: string, limit: number): Promise<CronRun[]>
```

The Gateway exposes cron operations via its REST API at ws://...
Look up the OpenClaw Gateway API docs format — cron trigger is:
`openclaw cron run <id>` which translates to a Gateway RPC call.
If the Gateway API for crons is unclear, fall back to: spawn a child_process
that runs `openclaw cron run <id>` on the host. Document the fallback in
SESSION-STATE-MC.md under "architectural decisions".

### API Routes
- `GET /api/crons` — returns CronJob[] from openclaw.ts
- `GET /api/crons/[id]/runs?limit=20` — returns CronRun[] from mc.db
- `POST /api/crons/[id]/trigger` — TOTP required, triggers the cron
- `PUT /api/crons/[id]` — TOTP required, update enabled/schedule

### Cron Page (`/crons/page.tsx`)

**Weekly Timeline View**
- 7-column grid Mon–Sun
- Each cron plotted as a pill at its America/Chicago scheduled time
- Use `cronstrue` for human-readable schedule
- Use `cron-parser` to compute next run time
- Prev/next week navigation (display only — no historical run data needed here)
- Click pill → selects job, updates the per-job panel below

**Per-Job Panel**
- Cron name, ID, schedule (expression + cronstrue description), agent, model override
- Status badge: ACTIVE / DISABLED / RUNNING
- Manual Trigger button (spinner while running, success/error toast after)
- Enable/Disable toggle (TOTP)
- Edit schedule (inline, TOTP to save)
- "Last run" summary: status badge + relative time

**Run History Drawer** (slide-in from right, triggered by clicking a run)
- Table of last 20 runs
- Click row: expand to show output excerpt, drive link, error message

## Stopping condition
- `pnpm typecheck && pnpm lint` pass
- All 6 crons visible in timeline
- Per-job panel updates on pill click
- Trigger button calls the API (even if Gateway isn't live — show appropriate error)
- `USE_FIXTURES=true` loads fixture cron runs
- Create `fixtures/crons.json`
- Write SESSION-STATE-MC.md


---


# SESSION 4 — Module 6: Workspace & Memory

## Prerequisite
Session 3 complete.

## Goal
Implement the Workspace page (`/workspace`) with file browser, memory browser,
global search, heartbeat state viewer, and read-only terminal.

## Scope

### API Routes
- `GET /api/workspace/tree` — returns recursive file tree of /openclaw/workspace/
  Max depth: 4 levels. Exclude: node_modules, .git, *.db, *.log
- `GET /api/workspace/file?path=relative/path.md` — returns file contents
  Path is relative to /openclaw/workspace/, must not contain `..`
  (path traversal protection: validate that resolved path starts with OPENCLAW_DIR)
- `PUT /api/workspace/session-state` — TOTP required
  Writes ONLY to SESSION-STATE.md. Reject any other path.
- `GET /api/workspace/search?q=term` — full-text search across all .md and .json files
  Returns: [{ path, matchCount, excerpt }]
- `GET /api/workspace/terminal` — TOTP not required (read-only)
  Query param: cmd — must be in the whitelist. Execute and return stdout.
  Whitelist: see SPEC.md Module 6 Read-Only Terminal section.

### Workspace Page (`/workspace/page.tsx`)

**Layout**: two-pane — file tree left, preview right

**File Tree**
- Expandable/collapsable directories
- File icons by type (.md, .json, .txt)
- Pinned files at top: SOUL.md, MEMORY.md, IDENTITY.md, TOOLS.md,
  AGENTS.md, SESSION-STATE.md, heartbeat-state.json

**Preview Pane**
- .md files: rendered HTML (use `marked` library)
- .json files: prettified with syntax highlighting (use a simple token colorizer,
  not a heavy library)
- SESSION-STATE.md: show "Edit" button that opens CodeMirror editor inline
- heartbeat-state.json: render as a key/value table, not raw JSON.
  Add "STALE" warning banner if last_heartbeat key is > 6 hours ago.

**Global Search**
- Debounced search input (300ms)
- Results show: file path + matching line + character range highlight
- Click result → opens file in preview pane, scrolls to match

**Read-Only Terminal**
- Monospace output panel
- Dropdown to select allowed command (not free-text input)
- "Run" button
- Output displayed below, cleared on next run

## Stopping condition
- `pnpm typecheck && pnpm lint` pass
- File tree renders from /openclaw mount (or fixtures)
- Markdown preview works
- Search returns results
- SESSION-STATE.md editable and saves
- Create `fixtures/workspace-tree.json`
- Write SESSION-STATE-MC.md


---


# SESSION 5 — Module 4: Task Board

## Prerequisite
Session 4 complete.

## Goal
Implement the Task Board page (`/tasks`) with full Kanban functionality,
Task-Specs/ inbox panel, and Telegram delivery integration.

## Scope

### API Routes
- `GET /api/tasks` — returns all tasks grouped by column
- `POST /api/tasks` — TOTP required, create task
- `PUT /api/tasks/[id]` — TOTP required, update task (including column move)
- `DELETE /api/tasks/[id]` — TOTP required
- `POST /api/tasks/[id]/send-telegram` — TOTP required
  Formats task as a structured message, sends to UID 1619919639 via Gateway
- `POST /api/tasks/[id]/send-drive` — TOTP required
  Creates a native Google Doc in Task-Specs/ folder
- `GET /api/tasks/task-specs` — polls Task-Specs/ Drive folder, returns unprocessed docs
- `POST /api/tasks/import-spec` — TOTP required, imports a Drive doc as a task card

### Task Board Page (`/tasks/page.tsx`)

**Kanban Board**
- 6 columns: Inbox, Assigned, In Progress, Review, Done, Archived
- Archived hidden by default, toggle to show
- Drag-and-drop (react-beautiful-dnd) — TOTP required for column changes
  (show a TOTP dialog on drop before committing the move)
- "New Task" button → slide-over form

**Task Card**
- Title, priority dot (P1=red, P2=orange, P3=blue, P4=gray), tag badge, agent avatar
- Click → opens Task Detail Panel (right side-panel)

**Task Detail Panel**
- All fields editable inline
- Status history timeline (query task_status_changes table)
- "Send to Telegram" button (TOTP)
- "Write to Drive" button (TOTP)
- Comments textarea (local only, SQLite)
- "Mark Done" / "Archive" quick actions

**Task-Specs/ Inbox Panel** (collapsible, below the board)
- Polls every 5 min
- Lists Drive docs not yet imported
- "Import as Task" button per row
- Shows: doc title, created date, Drive link

## Stopping condition
- `pnpm typecheck && pnpm lint` pass
- Task cards persist across page reload
- Column drag-and-drop works
- "New Task" form creates and saves a card
- Task-Specs/ panel shows (even if Drive not configured — show "Drive not configured")
- Write SESSION-STATE-MC.md


---


# SESSION 6 — Module 5: Claude Integration Loop

## Prerequisite
Session 5 complete. Google Drive API configured (service account JSON in env).

## Goal
Implement the Claude Loop page (`/claude-loop`) — Brief generator,
SESSION-STATE editor, deliverables browser, and Task-Specs writer.

## Scope

### Drive client: `src/lib/drive.ts` (create this file)
```typescript
// Google Drive API via service account
// Decode GOOGLE_SERVICE_ACCOUNT_JSON_B64, parse JSON, init googleapis client

async function writeGoogleDoc(folderId: string, title: string, content: string): Promise<{ id: string; url: string }>
async function listFolder(folderId: string): Promise<DriveFile[]>
async function readDoc(fileId: string): Promise<string>  // plain text extraction
```

### Brief Assembly: `src/lib/brief.ts` (create this file)
```typescript
// Assembles the Claude Brief from live dashboard data
// Pulls from: cost API, cron run history, task board, SESSION-STATE.md, activity feed

async function assembleBrief(notes: string): Promise<string>
// Returns markdown string with sections per SPEC.md Module 5
```

### API Routes
- `GET /api/drive/briefs` — returns brief_history from mc.db
- `POST /api/drive/briefs` — TOTP required, assemble + write brief to Drive, save to history
- `GET /api/drive/task-specs` — list Task-Specs/ folder
- `POST /api/drive/task-specs` — TOTP required, write a new task spec doc
- `GET /api/drive/deliverables` — list STG-Intelligence/ and Personal/ folders

### Claude Loop Page (`/claude-loop/page.tsx`)

**Section 1 — Brief Generator**
- "Notes" textarea (pre-populated from URL param if provided)
- "Generate Brief" button (TOTP) — shows progress steps while assembling
- After generation: "Open in Drive" link + "Copy URL" button
- Brief History table: date, title, Drive link (last 30)

**Section 2 — SESSION-STATE.md Editor**
- CodeMirror editor (same as workspace page)
- "Sync from Dashboard" button: regenerates from live data
- "Export for Claude" button: copies contents + prepended instruction to clipboard
- Auto-saves drafts to localStorage — wait, NO localStorage allowed.
  Auto-save to /api/workspace/session-state with debounce (5s). Show "Saving..." indicator.

**Section 3 — Deliverables Browser**
- File tree of deliverables/STG/, deliverables/Personal/, scratch/
- Preview pane same as workspace module
- "Add to Brief" button: queues file path for next brief generation

**Section 4 — Task-Specs Writer**
- Title input + markdown textarea
- "Write to Drive" button (TOTP)
- Shows confirmation with Drive link after write

## Stopping condition
- `pnpm typecheck && pnpm lint` pass
- Brief assembles from live data and writes to Drive (or shows clear error if Drive not configured)
- SESSION-STATE editor saves
- "Export for Claude" copies correctly formatted content
- Write SESSION-STATE-MC.md


---


# SESSION 7 — Module 1: Command Center & Live Feed

## Prerequisite
Session 6 complete.

## Goal
Implement the Command Center home page (`/`) with agent cards, the persistent
top status strip, and the live activity feed via Gateway WebSocket + SSE.

## Scope

### Gateway WebSocket bridge: `src/app/api/gateway/ws/route.ts`
- Server-side WebSocket connection to OpenClaw Gateway at OPENCLAW_GATEWAY_URL
- Auth: send gateway token on connection
- Handle device pairing: if Gateway sends pairing-required, log to console
  and surface error in UI ("Gateway pairing required — run: openclaw devices approve <id>")
- Transform incoming Gateway events into ActivityEvent objects
- Broadcast to all connected SSE clients via an in-memory event emitter

### SSE endpoint: `src/app/api/events/route.ts`
- Server-Sent Events stream
- Client connects → receives all activity events from the in-memory emitter
- Include heartbeat ping every 30s to keep connection alive
- Handle client disconnect cleanly

### Status strip component: `src/components/layout/StatusStrip.tsx`
- Reads from `/api/gateway/status` (gateway connected/disconnected)
- Reads from `/api/costs/summary` for OpenRouter balance
- Per-agent status dots from agent state (updated by Gateway events)
- America/Chicago clock

### Command Center Page (`/page.tsx`)
- Agent cards grid (see SPEC.md Module 1)
- Activity feed panel (right side or bottom depending on viewport)
- Feed filter bar: agent, event type, time range
- "Hide sensitive content" toggle (session cookie, not localStorage)

## Stopping condition
- `pnpm typecheck && pnpm lint` pass
- Status strip visible on all pages
- Agent cards render from openclaw.json
- Activity feed connects to SSE endpoint (even if Gateway offline — show "Gateway offline")
- With USE_FIXTURES=true, feed shows synthetic events
- Create `fixtures/activity-events.json`
- Write SESSION-STATE-MC.md


---


# SESSION 8 — Polish, Error Boundaries, Audit Log, Mobile

## Prerequisite
Sessions 0–7 complete. All modules functional.

## Goal
Production readiness: error boundaries on every module, audit log panel,
mobile-responsive layout, final lint/typecheck pass, acceptance criteria checklist.

## Scope

### Error Boundaries
- Wrap every module panel in a React error boundary component
- `src/components/ui/ErrorBoundary.tsx` — class component, renders:
  `<div>Module failed to load. <button>Retry</button></div>`
- Apply to: each VPS health panel, each cost panel, cron timeline, task board,
  activity feed, agent cards, each claude-loop section

### Audit Log Panel
- Route: `/security` → renders audit_log table from mc.db
- Table: Timestamp | Action | Resource | Result | IP
- Read-only, no controls
- Link in sidebar nav under a "Security" section

### Mobile Layout
- Sidebar: collapses to hamburger menu on < 768px
- Agent cards: 1 column on mobile
- Cron timeline: horizontal scroll on mobile (don't try to reflow to vertical)
- Task board: single-column scroll on mobile
- Status strip: show only gateway health + clock on mobile (hide agent dots)

### Final Acceptance Criteria Pass
Go through every item in SPEC.md acceptance criteria checklist.
For each item, verify it works and check it off in SPEC.md.
For any item not met, either fix it or document the gap in SESSION-STATE-MC.md.

### Docker final check
- `docker build -t mc-wintermute:latest .` must succeed
- `docker compose -f docker-compose.sidecar.yml config` must validate

### Commit
- `git add -A`
- `git commit -m "mc: v1.0 complete — all modules implemented"`
- `git tag v1.0`

## Stopping condition
- `pnpm typecheck && pnpm lint` pass with zero errors/warnings
- All acceptance criteria checked off or documented as known gaps
- Docker build succeeds
- SESSION-STATE-MC.md updated with final state
