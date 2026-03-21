# SESSION 5 — Module 4: Task Board

## How to run
```bash
cd /path/to/aerie
claude --dangerously-skip-permissions
```
Full tool access is pre-authorized. Do not ask for permission before reading,
writing, or running commands. Commit directly to main — no branches.
Stop at 80 turns if the stopping condition is not yet met.

## Prerequisite
Session 4 complete. Workspace page works.

## Context from Sessions 0–4 (read before writing any code)

**Auth imports:**
- Route Handlers: `getSession`, `validateTotpFromRequest` from `@/lib/auth`
- Middleware: `@/lib/session` only

**Always use existing helpers:**
- `src/lib/api-response.ts` — `errorResponse` / `successResponse`
- `src/lib/db.ts` — `getDb()` singleton — never instantiate Database directly
- `src/components/ui/error-boundary.tsx` — wrap every panel

**Database:** The `tasks` and `task_history` tables already exist in db.ts
migrations from Session 0. Check the schema before writing any queries:
```bash
grep -A 20 "CREATE TABLE IF NOT EXISTS tasks" mission-control/src/lib/db.ts
grep -A 10 "CREATE TABLE IF NOT EXISTS task_history" mission-control/src/lib/db.ts
```
Do not redefine or alter these tables — work with the existing schema.

**Auth pattern for all write routes:**
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

**SESSION-STATE.md editor:** was implemented as a `<textarea>` in Session 4
(not CodeMirror). This is intentional — do not add CodeMirror in this session.

---

## Goal
Implement the Task Board page (`/tasks`) with full Kanban functionality,
local SQLite persistence, Telegram delivery, and the Task-Specs/ Drive inbox.

## Scope

### API Routes

**`GET /api/tasks`**
- Returns all non-archived tasks grouped by column
- Shape: `{ inbox: Task[], assigned: Task[], 'in-progress': Task[], review: Task[], done: Task[] }`
- Archived tasks only returned when `?includeArchived=true`

**`POST /api/tasks`** — TOTP required
- Creates a new task, persists to SQLite, audit logged
- Body: `{ title, description?, agentId?, priority, tag, dueDate? }`
- Returns the created task

**`PUT /api/tasks/[id]`** — TOTP required
- Updates any task fields including `column` (for drag-and-drop moves)
- When `column` changes, insert a row into `task_history`
- Audit logged

**`DELETE /api/tasks/[id]`** — TOTP required
- Soft delete: moves task to `archived` column, does not remove from DB
- Audit logged

**`POST /api/tasks/[id]/send-telegram`** — TOTP required
- Formats task as a structured plain-text message
- Sends to `TELEGRAM_DELIVERY_UID` env var via the OpenClaw Gateway
- Use the Gateway client pattern from `src/lib/gateway.ts` (already exists)
- If Gateway unavailable: return `503` with clear error message
- Audit logged

**`POST /api/tasks/[id]/send-drive`** — TOTP required
- Creates a native Google Doc in `GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID`
- Title: `Task: [task title] — [YYYY-MM-DD]`
- Body: structured task brief (title, description, priority, tag, agent, due date)
- Returns Drive URL
- If Drive not configured (env var missing): return `503` with message
  "Google Drive not configured — set GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID"
- Audit logged

**`GET /api/tasks/task-specs`**
- Polls `GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID` for Google Docs
- Returns list of docs not yet imported (no matching task ID in local SQLite)
- If Drive not configured: return `{ data: [], configured: false }`

**`POST /api/tasks/import-spec`** — TOTP required
- Imports a Drive doc as a task card
- Body: `{ fileId, title }`
- Creates task in `inbox` column, links `linkedOutputUrl` to Drive doc

### Drive client: `src/lib/drive.ts` (create this file)
```typescript
// Google Drive API via service account
// Decode GOOGLE_SERVICE_ACCOUNT_JSON_B64 from env, parse JSON, init googleapis

export async function writeGoogleDoc(
  folderId: string,
  title: string,
  content: string
): Promise<{ id: string; url: string }>

export async function listFolder(folderId: string): Promise<DriveFile[]>

export async function readDocAsText(fileId: string): Promise<string>
```

If `GOOGLE_SERVICE_ACCOUNT_JSON_B64` is not set, all functions should throw a
typed error: `class DriveNotConfiguredError extends Error {}`. Callers catch
this and return `503`.

Add `DriveFile` type to `src/types/index.ts`.

### Task Board Page (`/tasks/page.tsx`)

**Kanban Board**
- 6 visible columns: Inbox | Assigned | In Progress | Review | Done | (Archived hidden)
- "Show Archived" toggle reveals a 6th column
- Column header: name + task count badge
- Drag-and-drop between columns using `react-beautiful-dnd` (already in package.json)
- On drop: call `PUT /api/tasks/[id]` with new column. TOTP required — show
  a TOTP confirmation dialog before committing the move. If user cancels,
  snap card back to original column.
- "New Task" button → slide-over panel

**Task Card**
- Title (truncated to 2 lines)
- Priority dot: P1=red, P2=orange, P3=blue, P4=grey
- Tag badge: STG / Personal / CW
- Agent name (if assigned)
- Due date (if set) — amber if overdue
- Click → opens Task Detail Panel

**New Task Slide-Over**
- Fields: title (required), description (markdown textarea), agent (dropdown
  from `getAgents()`), priority (P1–P4), tag (STG/Personal/CW), due date
- Save button — TOTP required

**Task Detail Panel** (right side-panel, opens on card click)
- All fields editable inline — save on blur, TOTP required for each change
- Status history timeline (from `task_history` table)
- "Send to Telegram" button — TOTP, shows success/error inline
- "Write to Drive" button — TOTP, shows Drive link after success
- "Mark Done" quick action — TOTP
- "Archive" action — TOTP

**Task-Specs/ Inbox Panel** (collapsible, below the Kanban board)
- Polls every 5 minutes via `/api/tasks/task-specs`
- If Drive not configured: show "Google Drive not configured" message — no error
- Lists unimported Drive docs: title, created date, Drive link, "Import" button
- "Import" → TOTP, calls `/api/tasks/import-spec`, adds card to Inbox column

## Stopping condition
- `pnpm typecheck && pnpm lint` pass with zero errors
- Task cards persist across page reload (SQLite)
- New task creation works end-to-end
- Column drag-and-drop triggers TOTP dialog and commits on confirm
- "Send to Telegram" returns appropriate error when Gateway unavailable
- "Write to Drive" returns `503` gracefully when Drive not configured
- Task-Specs/ panel shows "not configured" state cleanly
- `USE_FIXTURES=true` loads `fixtures/tasks.json`
- Create `fixtures/tasks.json` with 2–3 synthetic tasks per column
- Write SESSION-STATE-MC.md with FORWARD-IMPACT for Session 6
