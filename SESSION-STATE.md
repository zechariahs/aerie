# Agent Task Board — Session State

**Spec:** `SPEC-agent-task-board.md` (presented in chat)  
**Branch:** `claude/agent-task-board-VrfQx`  
**Last updated:** 2026-03-31

---

## PHASE STATUS

| Phase | Name | Status |
|-------|------|--------|
| 1 | Schema + Auth | ✅ Complete |
| 2 | API | ✅ Complete — awaiting approval to open Phase 3 |
| 3 | UI | ✅ Complete — awaiting approval to open Phase 4 |
| 4 | Executor Cron | Not started |

---

## PHASE 1 — Completed

**Commit:** `f2dbcd5`

### Files created:
- `app/src/app/api/settings/route.ts` — GET/PUT /api/settings

### Files modified:
- `app/src/types/index.ts` — added `needs_clarification` to TaskStatus, new types
  (TaskSource, TaskCapabilityTier, TaskClarificationState, ModelTiers), extended Task
- `app/src/lib/db.ts` — applyMigrationV3(): 8 new task columns, model_tiers table,
  settings table, env-var seeding of model_tiers
- `app/src/lib/auth.ts` — added isAgentRequest()
- `app/src/app/api/tasks/route.ts` — updated TaskRow/rowToTask, grouped initializer,
  POST auth (session+TOTP OR API key)
- `app/src/app/api/tasks/[id]/route.ts` — updated TaskRow/rowToTask, VALID_STATUSES,
  PUT auth (session+TOTP OR API key)
- `app/src/app/api/tasks/[id]/send-drive/route.ts` — updated TaskRow + inline task build
- `app/src/app/api/tasks/[id]/send-telegram/route.ts` — updated TaskRow + inline task build
- `app/src/app/api/tasks/import-spec/route.ts` — updated TaskRow/rowToTask
- `app/src/components/modules/tasks/kanban-board.tsx` — added needs_clarification to
  COLUMN_LABELS and tasks state initializer
- `env.example` + `app/.env.example` — added AGENT_API_KEY, AGENT_MODEL_{FAST,DEFAULT,
  REASONING}, AERIE_INTERNAL_URL

### Stopping conditions confirmed:
- `pnpm lint` → ✅ No ESLint warnings or errors
- `pnpm typecheck` → ✅ No new errors (pre-existing env/module errors unchanged)
- New task columns and tables will be created on first app startup (migration V3)
- `GET /api/settings` → 401 without auth; 200 with Bearer key or session
- `PUT /api/settings` → requires session + TOTP (human-only config)

---

## FORWARD-IMPACT

### Phase 2 — Completed (commit 34904e2)

Files created:
- `app/src/app/api/tasks/agent/route.ts` — GET /api/tasks/agent
- `app/src/app/api/tasks/model-tiers/route.ts` — GET/PUT /api/tasks/model-tiers

Files modified:
- `app/src/app/api/tasks/route.ts` — CreateTaskBody extended; INSERT writes source/capability_tier
- `app/src/app/api/tasks/[id]/route.ts` — UpdateTaskBody extended; UPDATE writes 7 new fields

## PHASE 3 — Completed

**Commit:** `95709d5`

### Files modified:
- `app/src/lib/task-columns.ts` — inserted `needs_clarification` between `in_progress` and `review`
- `app/src/components/modules/tasks/kanban-board.tsx` — added `needs_clarification` to `VISIBLE_COLUMNS`; warn color on column header
- `app/src/components/modules/tasks/task-card.tsx` — tier badges (reasoning/fast/auto), source badges (agent/api), pulsing `?` for `clarification_state === 'pending_board'`
- `app/src/components/modules/tasks/task-detail-panel.tsx` — Clarification Thread Q&A section with Submit Responses; Execution Info section (session ID, summary, artifact link)
- `app/src/components/modules/tasks/new-task-form.tsx` — Capability Tier selector (default/fast/reasoning/auto)
- `app/src/components/layout/sidebar.tsx` — added `{ href: '/settings', label: 'Settings' }` to `navItems`

### Files created:
- `app/src/app/(dashboard)/settings/page.tsx` — Settings page: Active Hours (AGENT_ACTIVE_START/END/TIMEZONE via /api/settings) + Model Tiers (fast/default/reasoning via /api/tasks/model-tiers), both TOTP-gated

### Stopping conditions confirmed:
- `pnpm lint` → ✅ No ESLint warnings or errors
- `pnpm typecheck` → ✅ No new errors

---

## FORWARD-IMPACT

### Phase 4 notes (for next planning session):

- `resolved_model` field on AgentTask (in /api/tasks/agent) is `string | undefined`.
  For `auto` tier it is always `undefined` — executor resolves per §5 heuristic.

- The `VALID_TIERS` and `VALID_CLARIFICATION_STATES` arrays are defined locally in
  `[id]/route.ts`. No changes needed to types.ts.

- `clarification_questions` / `clarification_responses` arrive from the API as
  `string[] | undefined` and the detail panel should render them that way.

- `needs_clarification` column is in COLUMN_LABELS but NOT in VISIBLE_COLUMNS yet —
  Phase 3 adds it there and handles the display.

---

## SCHEMA (post-Phase-1)

```sql
-- tasks table additions (migration V3)
source              TEXT NOT NULL DEFAULT 'manual'
capability_tier     TEXT NOT NULL DEFAULT 'default'
clarification_questions  TEXT        -- JSON array of strings
clarification_responses  TEXT        -- JSON array of strings
clarification_state      TEXT NOT NULL DEFAULT 'none'
execution_session_id     TEXT
output_summary           TEXT
output_artifact_url      TEXT

-- new tables (migration V3)
CREATE TABLE model_tiers (
  tier       TEXT PRIMARY KEY,
  model_id   TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## ENV VARS ADDED

```bash
AGENT_API_KEY=          # agents: Authorization: Bearer <key>
AGENT_MODEL_FAST=       # seeds model_tiers.fast at migration
AGENT_MODEL_DEFAULT=    # seeds model_tiers.default at migration
AGENT_MODEL_REASONING=  # seeds model_tiers.reasoning at migration
AERIE_INTERNAL_URL=     # internal base URL for agent API calls
```
