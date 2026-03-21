# SESSION 4 — Module 6: Workspace & Memory

## How to run
```bash
cd /path/to/aerie
claude --dangerously-skip-permissions
```
Full tool access is pre-authorized. Do not ask for permission before reading,
writing, or running commands. Commit everything directly to main — no branches.

## Prerequisite
Session 3 complete. Cron manager page works.

## Verify first — cron data source fix
Before writing any new code, confirm `src/lib/openclaw.ts` reads cron jobs
from `cron/jobs.json` (not `openclaw.json`). Run:
```bash
grep -n "jobs.json\|cron/jobs\|openclaw.json" mission-control/src/lib/openclaw.ts
```
Expected: a reference to `cron/jobs.json` or `cron/jobs`. If it still reads
crons from `openclaw.json`, fix `getCronJobs()` to use the real path before
proceeding. Document outcome in SESSION-STATE-MC.md either way.

## Context from Sessions 0–3 (read before writing any code)

**Auth imports:**
- Route Handlers: `getSession`, `validateTotpFromRequest` from `@/lib/auth`
- Middleware: `@/lib/session` only

**Always use existing helpers:**
- `src/lib/api-response.ts` — `errorResponse` / `successResponse`
- `src/lib/db.ts` — `getDb()` singleton
- `src/lib/openclaw.ts` — `getAgents()`, `getCronJobs()`, `readCronRuns()`
- `src/components/ui/error-boundary.tsx` — wrap every panel

**Auth pattern for write routes:**
```typescript
import { getSession, validateTotpFromRequest } from '@/lib/auth';
import { errorResponse, successResponse } from '@/lib/api-response';

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);
  if (!validateTotpFromRequest(request)) return errorResponse('TOTP required', 403);
  // ... business logic
}
```

**Path traversal protection — use this exact pattern for all file reads:**
```typescript
import path from 'path';

const WORKSPACE_DIR = path.resolve(
  process.env['OPENCLAW_DIR'] ?? '/openclaw', 'workspace'
);

function safeResolvePath(relativePath: string): string {
  if (relativePath.includes('..')) throw new Error('Invalid path');
  const resolved = path.resolve(WORKSPACE_DIR, relativePath);
  if (!resolved.startsWith(WORKSPACE_DIR + path.sep)) {
    throw new Error('Path traversal attempt rejected');
  }
  return resolved;
}
```

**The /openclaw mount is read-only** — except SESSION-STATE.md which has a
dedicated write endpoint. No other workspace files may be written.

---

## Goal
Implement the Workspace & Memory page (`/workspace`) with file browser,
markdown preview, global search, heartbeat state viewer, and read-only terminal.

## Scope

### API Routes

**`GET /api/workspace/tree`**
- Returns recursive file tree of `/openclaw/workspace/`
- Max depth: 4 levels
- Exclude: `node_modules/`, `.git/`, `*.db`, `*.log`, `*.jsonl`
- Response shape: `{ name, path, type: 'file'|'dir', children?: [...] }[]`
- Pinned files surfaced at top of root level:
  `SOUL.md`, `MEMORY.md`, `IDENTITY.md`, `TOOLS.md`, `AGENTS.md`,
  `SESSION-STATE.md`, `heartbeat-state.json`

**`GET /api/workspace/file?path=relative/path.md`**
- Path is relative to `/openclaw/workspace/`
- Apply `safeResolvePath()` before reading — reject any path containing `..`
- Returns: `{ content: string, path: string, mimeType: string }`
- Supported types: `.md`, `.json`, `.txt`, `.jsonl` (first 100 lines only)
- Unknown types: return `{ error: 'Cannot preview this file type' }`

**`PUT /api/workspace/session-state`**
- TOTP required
- Writes ONLY to `SESSION-STATE.md` — hardcode this path, accept no other
- Body: `{ content: string }`
- Audit logged

**`GET /api/workspace/search?q=term`**
- Full-text search across all `.md` and `.json` files in `/openclaw/workspace/`
- Returns: `[{ path, matchCount, excerpt }]` — excerpt is the matching line
  with 50 chars of context either side, max 3 excerpts per file
- Case-insensitive, minimum 2 characters

**`GET /api/workspace/terminal?cmd=uptime`**
- Executes whitelisted commands only using `execFile` (never `exec`)
- Whitelist (exact match on cmd param, no args allowed from client):
  ```
  uptime          → execFile('uptime', [])
  df-h            → execFile('df', ['-h'])
  free-m          → execFile('free', ['-m'])
  cron-list       → execFile('openclaw', ['cron', 'list'])
  ```
- Returns: `{ output: string, cmd: string }`
- Returns `400` for any cmd not in the whitelist

### Workspace Page (`/workspace/page.tsx`)

**Layout:** Two-pane — file tree left (~30%), preview right (~70%).
Collapsible on mobile (tree becomes a drawer).

**File Tree (left pane)**
- Expandable/collapsable directories (client-side state, no re-fetch on expand)
- File type icons: 📄 `.md`, `{}` `.json`, `📋` other
- Pinned files shown at top with a subtle separator below them
- Active file highlighted
- Click file → loads preview

**Preview Pane (right pane)**
- `.md` → rendered HTML via `marked`. Apply basic prose styling.
- `.json` → prettified with syntax highlighting (implement a simple tokenizer —
  strings=green, keys=blue, numbers=amber, booleans=purple, nulls=grey).
  Do not add a heavy library for this.
- `SESSION-STATE.md` → rendered markdown + "Edit" button that swaps to
  CodeMirror editor inline. "Save" requires TOTP. "Cancel" restores preview.
- `heartbeat-state.json` → key/value table (not raw JSON).
  Show "⚠️ STALE" banner if `last_heartbeat` timestamp > 6 hours ago.
- Empty state: "Select a file to preview"

**Global Search**
- Input at top of page, debounced 300ms
- Results appear inline below the search bar (not in the preview pane)
- Each result: file path (clickable → loads file) + matching excerpts
- Clear button to dismiss results and return to normal tree view

**Read-Only Terminal**
- Collapsible panel at bottom of page (collapsed by default)
- Dropdown to select command (not free-text input — the whitelist is the options)
- "Run" button → calls `/api/workspace/terminal?cmd=<selected>`
- Output in monospace panel, cleared on next run

## Stopping condition
- `pnpm typecheck && pnpm lint` pass with zero errors
- File tree renders (from fixtures if `USE_FIXTURES=true`)
- Markdown preview renders `.md` files
- SESSION-STATE.md edit + save flow works end-to-end
- Search returns results
- Terminal panel executes whitelisted commands
- Cron data source verified and documented in SESSION-STATE-MC.md
- Create `fixtures/workspace-tree.json` with synthetic file tree
- Write SESSION-STATE-MC.md with FORWARD-IMPACT for Session 5
