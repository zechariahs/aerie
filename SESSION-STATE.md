# Agent Task Board — Session State

**Spec:** `SPEC-agent-task-board.md` (presented in chat)  
**Branch:** `claude/agent-task-board-VrfQx`  
**Last updated:** 2026-03-31

---

## PHASE STATUS

| Phase | Name | Status |
|-------|------|--------|
| 1 | Schema + Auth | ✅ Complete — awaiting approval to open Phase 2 |
| 2 | API | Not started |
| 3 | UI | Not started |
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

### Phase 2 notes (for next planning session):

- `clarification_questions` and `clarification_responses` are stored as JSON strings in
  SQLite and parsed to `string[]` in rowToTask. Phase 2's PUT /api/tasks/[id] must
  serialize incoming `string[]` to JSON before writing.

- The `grouped` response from GET /api/tasks now includes a `needs_clarification` key
  (empty array). Phase 2's GET /api/tasks/agent endpoint is a separate route that does
  not use the grouped structure.

- `DELETE /api/tasks/[id]` was intentionally left as session+TOTP only (no API key).
  Agents cannot delete tasks per spec §3.

- Auth pattern used in Phase 1: `isAgentRequest()` checks exact `Bearer <key>` match
  against `AGENT_API_KEY` env var. Same function to be used in Phase 2 new routes.

- `GET /api/settings` accepts session OR API key (agent needs to read active hours at
  cron runtime). Spec §13 says "session + TOTP" for the endpoint pair, but the agent
  executor clearly needs read access — this design matches spec intent.

- `model_tiers` env seeding only happens at migration time (app start). If env vars
  change after migration, they are NOT re-seeded. Use PUT /api/tasks/model-tiers
  (Phase 2) to update at runtime.

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
