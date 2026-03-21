# SESSION 6 — Module 5: Claude Integration Loop

## How to run

```bash
cd /path/to/aerie
claude --dangerously-skip-permissions
```

Full tool access is pre-authorized. Do not ask for permission before reading,
writing, or running commands. Commit directly to main — no branches.
Stop at 80 turns if the stopping condition is not yet met.

## Prerequisite

Session 5 complete. Task board works.

## Context from Sessions 0–5 (read before writing any code)

**Auth imports:**

- Route Handlers: `getSession`, `validateTotpFromRequest` from `@/lib/auth`
- Middleware: `@/lib/session` only

**Always use existing helpers:**

- `src/lib/api-response.ts` — `errorResponse` / `successResponse`
- `src/lib/db.ts` — `getDb()` singleton
- `src/components/ui/error-boundary.tsx` — wrap every panel

**`src/lib/drive.ts` already exists as typed stubs** — expand it, do not
recreate it. The real implementation goes in here. `DriveFile` type already
exists in `src/types/index.ts` — do not redefine it.

**`brief_history` table already exists** in db.ts migrations (id, title,
drive_url, created_at). Use it directly.

**`task_comments` and `task_status_changes` tables** were added in Session 5.
Do not re-migrate them.

**SESSION-STATE.md editor** is a `<textarea>` in the workspace page (Session 4
decision — CodeMirror was not in approved stack). If you add CodeMirror in this
session, also retrofit `SessionStateEditor` in
`src/app/(dashboard)/workspace/page.tsx` to use the same component.

**Auth pattern for write routes:**

```typescript
import { getSession, validateTotpFromRequest } from '@/lib/auth';
import { errorResponse, successResponse } from '@/lib/api-response';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);
  if (!validateTotpFromRequest(request)) return errorResponse('TOTP required', 403);
  // ... business logic
}
```

**Google Drive folder IDs come from env vars only:**

- `GOOGLE_DRIVE_STG_FOLDER_ID`
- `GOOGLE_DRIVE_PERSONAL_FOLDER_ID`
- `GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID`
- `GOOGLE_DRIVE_MC_BRIEFS_FOLDER_ID`
  Never hardcode folder IDs. If an env var is missing, throw `DriveNotConfiguredError`.

-----

## Goal

Implement the Claude Integration Loop page (`/claude-loop`) — the bridge between
Wintermute's async outputs and Claude (claude.ai) interactive sessions.

## Scope

### Expand `src/lib/drive.ts` (do not recreate — expand the existing stubs)

Implement the following fully:

```typescript
// Decode GOOGLE_SERVICE_ACCOUNT_JSON_B64 from env (base64 → JSON → auth client)
// Throw DriveNotConfiguredError if env var missing

export async function writeGoogleDoc(
  folderId: string,
  title: string,
  content: string        // plain text — Drive API creates as Google Doc
): Promise<{ id: string; url: string }>

export async function listFolder(folderId: string): Promise<DriveFile[]>

export async function readDocAsText(fileId: string): Promise<string>
```

All functions must handle `DriveNotConfiguredError` at the call site — never
let it propagate uncaught to the client.

### Brief assembly: `src/lib/brief.ts` (create this file)

```typescript
/**
 * Assembles a structured Claude context brief from live dashboard data.
 * Pulls from: cost summary, cron run history, task board (Review column),
 * recent activity errors, and SESSION-STATE.md content.
 */
export async function assembleBrief(notes: string): Promise<string>
```

Brief format (markdown string):

```
## WintermuteTuring Operational Brief — [YYYY-MM-DD HH:mm CT]

### Agent Status
[per agent from getAgents(): name, model]

### Cron Summary (last 7 days)
[per cron from getCronJobs(): name, lastRunStatus, lastRunAt relative time,
consecutiveErrors if > 0]

### Cost Summary (last 7 days)
[from getCostSummary(): thisWeek spend, projectedMonth, vsLastMonth]

### Open Tasks (Review column)
[tasks in review column from SQLite — title, priority, tag, linked output URL]

### Recent Errors (last 24h)
[crons with lastRunStatus=error and their lastError strings]

### SESSION-STATE.md
[full contents of /openclaw/workspace/SESSION-STATE.md — read via filesystem,
not via API route]

### Notes
[notes param — empty string if not provided]
```

### API Routes

**`GET /api/drive/briefs`**

- Returns `brief_history` table contents, newest first, last 30 rows

**`POST /api/drive/briefs`** — TOTP required

- Body: `{ notes?: string }`
- Calls `assembleBrief(notes)`
- Writes result as Google Doc to `GOOGLE_DRIVE_MC_BRIEFS_FOLDER_ID`
- Title: `WintermuteTuring Brief — [YYYY-MM-DD]`
- Saves to `brief_history` table
- Returns `{ id, url, title, generatedAt }`
- Audit logged

**`GET /api/drive/task-specs`**

- Lists `GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID` folder
- Returns `{ data: DriveFile[], configured: boolean }`

**`POST /api/drive/task-specs`** — TOTP required

- Body: `{ title, content }`
- Creates a Google Doc in `GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID`
- Returns Drive URL

**`GET /api/drive/deliverables`**

- Lists `GOOGLE_DRIVE_STG_FOLDER_ID` and `GOOGLE_DRIVE_PERSONAL_FOLDER_ID`
- Returns `{ stg: DriveFile[], personal: DriveFile[], configured: boolean }`

### Claude Loop Page (`/claude-loop/page.tsx`)

Four sections, each wrapped in `ErrorBoundary`:

**Section 1 — Brief Generator**

- "Notes" textarea (placeholder: "Add context for this brief…")
- "Generate Brief" button — TOTP required
  - Shows step progress while assembling: "Gathering cron data…" →
    "Reading cost summary…" → "Writing to Drive…" → "Done"
  - On success: "Open in Drive" link + "Copy URL" button
- Brief History table below: Generated At | Title | Drive link (last 30)
- If Drive not configured: show "Drive not configured" banner, disable button

**Section 2 — SESSION-STATE.md Editor**

- Same editor as workspace page (textarea or CodeMirror if added)
- "Sync from Dashboard" button: regenerates SESSION-STATE.md content from
  live data (same content as brief, formatted as SESSION-STATE.md structure)
  — TOTP required
- "Export for Claude" button: copies this text to clipboard:

  ```
  The following is the current operational state of WintermuteTuring.
  Use this as context for this session.
  ---
  [SESSION-STATE.md contents]
  ```

  Show "Copied!" confirmation for 2 seconds.
- Auto-save: debounce 3 seconds, calls `PUT /api/workspace/session-state`
  — TOTP required, show "Saving…" indicator

**Section 3 — Deliverables Browser**

- File tree of deliverables from Drive (STG + Personal folders)
- If Drive not configured: "Drive not configured" — no error state
- Click file → preview in a right panel (plain text extraction via `readDocAsText`)
- "Add to Brief" button: queues file path into the Notes textarea for next
  brief generation (appends, doesn't overwrite)

**Section 4 — Task-Specs Writer**

- Title input + markdown textarea
- "Write to Drive" button — TOTP required
- Shows Drive link on success
- If Drive not configured: disable button, show message

## Stopping condition

- `pnpm typecheck && pnpm lint` pass with zero errors
- Brief assembles from live data (or fixtures) and writes to Drive
  (or shows "not configured" cleanly if Drive env vars absent)
- SESSION-STATE.md editor saves with TOTP
- "Export for Claude" copies correctly formatted content to clipboard
- If CodeMirror was added: workspace page SESSION-STATE editor also updated
- `USE_FIXTURES=true` loads `fixtures/claude-loop.json`
- Create `fixtures/claude-loop.json` with synthetic brief history + deliverables
- Write SESSION-STATE-MC.md with FORWARD-IMPACT for Session 7
