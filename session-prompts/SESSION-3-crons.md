# SESSION 3 — Module 2: Cron Manager

## Prerequisite
Session 2 complete. Cost page works.

## Repo instruction
Work in the existing repo only. Do not run `git init` or create any nested
`.git` directory. All files go into the existing `aerie` repo.

## Context from Sessions 0–2 (read before writing any code)

**Auth imports:**
- Route Handlers: `getSession`, `validateTotpFromRequest` from `@/lib/auth`
- Middleware: `@/lib/session` only

**Always use existing helpers:**
- `src/lib/api-response.ts` — `errorResponse` / `successResponse`
- `src/lib/db.ts` — `getDb()` singleton
- `src/components/ui/error-boundary.tsx` — wrap every panel

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

---

## Critical discovery — update `src/lib/openclaw.ts` first

**OpenClaw does NOT store cron config in `openclaw.json`.** Crons live in a
separate file. The existing `getCronJobs()` in `src/lib/openclaw.ts` is reading
the wrong source. **Fix this before building anything else in this session.**

### Real data locations on the /openclaw mount:

**Cron config:** `/openclaw/cron/jobs.json`

Real schema:
```json
{
  "version": 1,
  "jobs": [{
    "id": "63530884-0b5e-46f3-a1bc-3436da045a01",
    "agentId": "wintermute",
    "name": "competitor-changelog-monitor",
    "enabled": true,
    "createdAtMs": 1773013238233,
    "updatedAtMs": 1773870395106,
    "schedule": {
      "kind": "cron",
      "expr": "0 7 * * 1",
      "tz": "America/Chicago"
    },
    "payload": {
      "kind": "agentTurn",
      "message": "...",
      "timeoutSeconds": 300,
      "model": "openrouter/..."  // optional — only present if overridden
    },
    "delivery": {
      "mode": "announce",
      "channel": "1619919639"
    },
    "state": {
      "nextRunAtMs": 1774267200000,
      "lastRunAtMs": 1773870273041,
      "lastRunStatus": "ok",      // "ok" | "error"
      "lastStatus": "ok",
      "lastDurationMs": 122065,
      "lastDelivered": true,
      "lastDeliveryStatus": "delivered", // "delivered" | "not-delivered" | "unknown"
      "consecutiveErrors": 0,
      "lastError": "optional string"
    }
  }]
}
```

**Run history:** `/openclaw/cron/runs/<cron-id>.jsonl`
- One file per cron, named by the cron's UUID
- Each line is one JSON run entry (JSONL format — read line by line)

Real run entry schema:
```json
{
  "ts": 1773869296909,
  "jobId": "51d8a322-8ad6-4ba0-8b44-e964014449af",
  "action": "finished",
  "status": "ok",
  "summary": "Heartbeat message delivered.",
  "delivered": true,
  "deliveryStatus": "delivered",
  "sessionId": "283cdba4-...",
  "runAtMs": 1773869288934,
  "durationMs": 7974,
  "nextRunAtMs": 1773914400000,
  "model": "moonshotai/kimi-k2-0905",
  "provider": "openrouter",
  "usage": {
    "input_tokens": 263,
    "output_tokens": 112,
    "total_tokens": 11717
  },
  "error": "optional string — only present on failure"
}
```

### Update `src/lib/openclaw.ts`:
Replace `getCronJobs()` to read from `/openclaw/cron/jobs.json` instead of
`openclaw.json`. New function to add:

```typescript
export function readCronJobs(): CronJobFromFile[]  // reads cron/jobs.json
export function readCronRuns(cronId: string, limit: number): CronRunFromFile[]
  // reads cron/runs/<cronId>.jsonl, returns last N entries newest-first
```

Add types to `src/types/index.ts` matching the real schemas above. The existing
`CronJob` type in types/index.ts should be updated or replaced to match.

### Fix cost attribution in `src/lib/cost.ts`:
Session 2 left cron attribution as a placeholder. Now that we have real run files
with `usage.input_tokens`, `usage.output_tokens`, and `jobId`, update
`buildCronSummaryRows()` to:
1. For each cron, read its `.jsonl` run file
2. Sum token usage across runs in the requested date range
3. Compute cost using `computeCost()` with the price table
This replaces the proportional approximation entirely.

---

## Goal
Implement the Cron Manager page (`/crons`) with the weekly timeline view,
per-job controls, and run history from the real filesystem data.

## Scope

### Gateway client: `src/lib/gateway.ts` (create this file)

Used only for **triggering** crons — reading is done via filesystem.

**Approach A — Gateway HTTP (try first):**
Check if `http://openclaw-v5t3-openclaw-1:18789/api/crons/<id>/run` responds.
If it does, use it.

**Approach B — child_process fallback:**
```typescript
// REQUIRES_GATEWAY
import { execFile } from 'child_process';

async function triggerCron(cronId: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile('openclaw', ['cron', 'run', cronId], { timeout: 30_000 }, (err) => {
      if (err) resolve({ ok: false, error: err.message });
      else resolve({ ok: true });
    });
  });
}
```

Document which approach worked in SESSION-STATE-MC.md.

### API Routes
- `GET /api/crons` — reads `cron/jobs.json` via `readCronJobs()`
- `GET /api/crons/[id]/runs?limit=20` — reads `cron/runs/<id>.jsonl` via `readCronRuns()`
- `POST /api/crons/[id]/trigger` — TOTP required, calls gateway.triggerCron(), audit logged
- `PUT /api/crons/[id]` — TOTP required — **read-only mount means no direct file write**.
  For enable/disable: call the OpenClaw Gateway API if available, otherwise
  flag as "not supported without Gateway" and document in SESSION-STATE-MC.md.

### Cron Page (`/crons/page.tsx`)

**Weekly Timeline View**
- 7-column grid Mon–Sun, horizontal time axis 0h–24h
- Each cron plotted as a pill at its `schedule.tz`-adjusted time (America/Chicago)
- Use `cronstrue` for human-readable description
- Use `cron-parser` to compute next run and plot position
- Include disabled crons (e.g., moltbook-engagement) — show as muted/greyed pill
- Pill color: green=ok, red=consecutive errors > 0, grey=disabled
- Prev/next week navigation
- Click pill → selects job, updates per-job panel

**Per-Job Panel**
- Cron name, ID, schedule expr + cronstrue description
- Assigned agent, model override (from `payload.model` if present)
- Status badge: ACTIVE / DISABLED / ERROR (red if `state.consecutiveErrors > 0`)
- **Delivery error banner** — if `state.lastError` contains "No delivery target
  resolved", show a prominent amber warning:
  "⚠️ Delivery misconfigured — channel cannot be resolved"
  This surfaces the known Telegram delivery bug for heartbeat and reddit-engagement-brief.
- Manual Trigger button — spinner, inline result
- "Last run" summary: status, relative time, duration, token count from state

**Run History Drawer** (slide-in from right)
- Table of last 20 runs from `.jsonl` file
- Per-run: timestamp, status badge (ok/error), duration ms, input+output tokens, cost estimate
- Click row: expand to show summary text, error message (if any)
- Token cost computed from `computeCost()` using price table

## Stopping condition
- `pnpm typecheck && pnpm lint` pass with zero errors
- `getCronJobs()` reads from `cron/jobs.json` (not openclaw.json)
- All 7 crons visible in timeline (including disabled moltbook-engagement)
- Delivery error banner visible on heartbeat and reddit-engagement-brief crons
  when `USE_FIXTURES=true` (include consecutive errors in fixture data)
- Run history drawer shows token usage and cost per run
- `buildCronSummaryRows()` in cost.ts uses real token data from `.jsonl` files
- `USE_FIXTURES=true` loads `fixtures/crons.json`
- Create `fixtures/crons.json` matching real schema above
- Write SESSION-STATE-MC.md with FORWARD-IMPACT for Session 4

## Fixture file to create: `fixtures/crons.json`
Must match the real schema. Include:
- All 7 crons from jobs.json (6 active + moltbook-engagement disabled)
- heartbeat with `consecutiveErrors: 1` and lastError "No delivery target resolved..."
- reddit-engagement-brief with `consecutiveErrors: 2` and same error
- 5 synthetic run entries per cron in a `runs` map keyed by cron ID
