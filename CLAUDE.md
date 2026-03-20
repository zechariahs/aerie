# WintermuteTuring Mission Control — Claude Code Context

Read this file completely before writing any code. It is the source of truth for
all architectural decisions. SPEC.md contains the full feature specification.
Session prompt files in session-prompts/ define per-session scope.

---

## Project Overview

A self-hosted operations dashboard for WintermuteTuring, an autonomous OpenClaw
agent running on a Hostinger VPS. Built as a Docker Compose sidecar alongside
the existing OpenClaw stack. Multi-agent ready from day one; currently operates
one agent (Wintermute) with the expectation of adding more.

The dashboard serves four primary purposes:
1. Operational visibility — cron status, agent health, VPS metrics
2. Cost control — provider-agnostic token and spend tracking
3. Task orchestration — Kanban board for dispatching work to agents
4. Claude integration loop — structured handoff between Wintermute's async
   outputs and Claude (claude.ai) interactive sessions via Google Drive

---

## OPSEC — This Repo Is Public

**This repository is public on GitHub. Every file you commit is visible to
anyone on the internet. Treat every commit as a public disclosure.**

### Hard rules — violations require an immediate force-push to scrub history:

- **NEVER commit any of the following**, in any file, comment, or string:
  - API keys, tokens, passwords, or hashes of any kind
  - Private IP addresses or internal hostnames beyond what's already documented
  - Telegram UIDs, bot tokens, or channel IDs (use env vars: `TELEGRAM_DELIVERY_UID`)
  - Google service account JSON or any credential file
  - OpenRouter, Anthropic, or any provider API key
  - Gateway auth tokens
  - TOTP secrets or seed values
  - Session secrets or cookie signing keys
  - Any value from the VPS `.env` file
  - Real Google Drive folder IDs (use env vars: `GOOGLE_DRIVE_*_FOLDER_ID`)

- **All secrets live in `.env.production` and `.env.local` — never committed.**
  These files must be in `.gitignore` before the first commit. Verify with
  `git check-ignore -v .env.production` before pushing.

- **`.env.example` is the only env file committed.** It must contain only
  placeholder values (empty strings or descriptive labels like `your-value-here`).
  Never populate `.env.example` with real values.

- **`SESSION-STATE-MC.md` is gitignored.** It contains operational state that
  could reveal infrastructure details. Add it to `.gitignore` immediately in
  Session 0.

- **Fixture files must not contain real data.** Fixtures in `fixtures/` use
  synthetic data only. No real session IDs, cron IDs, agent names that reveal
  project details, or file paths that expose workspace structure.

- **Code comments must not contain operational details.** No VPS paths,
  container names, or Telegram UIDs in comments. Reference env var names instead:
  `// Delivers to TELEGRAM_DELIVERY_UID` not `// Delivers to 1619919639`.

### What IS acceptable to commit (already public or non-sensitive):
- Port numbers (18789, 3100, 3101, 60340) — already scannable
- Container naming conventions (`openclaw-v5t3-openclaw-1`) — structural, not secret
- VPS hostname in documentation — already in DNS
- Cron schedule expressions — no operational value to an attacker
- Model IDs and provider names — public information

### `.gitignore` requirements (Session 0 must create this before first commit):
```
.env
.env.local
.env.production
.env.*.local
*.env
mission-control/.env.production
mission-control/.env.local
SESSION-STATE-MC.md
/app/data/
*.db
*.db-shm
*.db-wal
node_modules/
.next/
mission-control-host-agent/dist/
```

### Pre-commit check (add to Session Handoff Protocol):
Before every `git commit`, run:
```bash
git diff --cached | grep -iE "(api_key|token|secret|password|hash|Bearer|sk-|pk-)" && echo "STOP — potential secret in diff" || echo "clean"
```
If it triggers, do not commit. Investigate and remove before proceeding.

---

## Infrastructure (do not deviate from this)

```
VPS:         srv1398517.hstgr.cloud (Hostinger)
Container:   openclaw-v5t3-openclaw-1
Network:     openclaw-v5t3_default
Gateway:     ws://openclaw-v5t3-openclaw-1:18789 (loopback only, never public)
Data path:   /docker/openclaw-v5t3/data/.openclaw/  (mounted read-only as /openclaw)
Hostinger:   External port 60340 → Nginx → Mission Control :3100
Repo:        github.com/zechariahs/wintermute-agent (branch: main)
Timezone:    America/Chicago
```

Mission Control lives at `/mission-control/` within the repo root. Docker Compose
config lives at repo root as `docker-compose.sidecar.yml`, appended to the
existing stack on deployment.

---

## Tech Stack — Non-Negotiable

| Layer | Choice | Version |
|---|---|---|
| Framework | Next.js App Router | 15.x |
| Language | TypeScript | 5.x strict mode |
| Styling | Tailwind CSS | v4 |
| Charts | Recharts | latest |
| Local DB | better-sqlite3 | latest |
| Auth | argon2 + otplib | latest |
| Realtime (feed) | Server-Sent Events | native |
| Realtime (gateway) | WebSocket | native ws library |
| Drive integration | googleapis | latest |
| Package manager | pnpm | latest |

Do not introduce dependencies outside this list without creating a file called
`DEPENDENCY-DECISION-[name].md` explaining the rationale and flagging it for
review. This constraint is strict.

---

## Architecture

```
Browser
  │  HTTPS via Hostinger proxy 60340 → Nginx → 127.0.0.1:3100
  ▼
Next.js App (mission-control container, port 3100)
  ├── /api/gateway/ws     → WebSocket bridge → openclaw-v5t3-openclaw-1:18789
  ├── /api/events         → SSE stream (activity feed, built from Gateway events)
  ├── /api/crons/*        → Cron read/trigger via Gateway API
  ├── /api/costs/*        → OpenRouter API + SQLite reads
  ├── /api/tasks/*        → Local SQLite (task board persistence)
  ├── /api/workspace/*    → Filesystem reads from /openclaw mount
  ├── /api/drive/*        → Google Drive API (service account)
  ├── /api/vps/*          → Host metrics endpoint (see below)
  └── /api/auth/*         → Login, TOTP verify, session management

Host metrics sidecar (separate tiny process, NOT inside Next.js):
  A minimal Node.js HTTP server running on the HOST (not in the container)
  that reads /proc/meminfo, /proc/stat, /proc/net/dev, df output, and
  docker stats. Listens on 127.0.0.1:3101. Mission Control proxies to it.
  Lives at /mission-control-host-agent/ in the repo.
```

---

## Critical Constraints

### Never do these things:
- **NO localStorage or sessionStorage** — ever, anywhere. Use React state or
  server-side session only.
- **NO writes to /openclaw mount** — it is read-only. All writes go to the
  local SQLite DB at /app/data/mc.db or to Google Drive via API.
- **NO public Gateway exposure** — the Gateway WebSocket is on loopback. The
  dashboard proxies it; it never goes through the client browser directly.
- **NO hardcoded secrets** — all credentials come from environment variables
  defined in .env.local (dev) or the Docker environment block (prod).
- **NO modules outside SPEC.md** — if a feature isn't in the spec, don't build
  it. Flag it as a suggestion in a SUGGESTIONS.md file instead.
- **NO skipping TOTP for write operations** — any action that mutates state
  (cron trigger, file edit, task create/update, brief generation) requires a
  valid TOTP token in the request header. Read-only views require only the
  session cookie.

### Always do these things:
- **Per-section error boundaries on every dashboard module** — one broken
  module must not crash others.
- **Fail visibly, not silently** — if a data source is unavailable (Gateway
  offline, Drive API error, SQLite locked), show a clear error state in that
  module. Never show stale data without labeling it as stale.
- **Provider-agnostic cost tracking** — cost data comes from OpenRouter's
  `/api/v1/usage` endpoint + a local price table keyed by model ID. No
  Anthropic Console dependency, no OAuth token assumptions.
- **Multi-agent layout from day one** — agent cards, cron filters, task
  assignments, and cost breakdowns must all support N agents, not assume 1.
  Use the agent ID from openclaw.json as the key throughout.

---

## Environment Variables

```bash
# OpenClaw
OPENCLAW_DIR=/openclaw
OPENCLAW_GATEWAY_URL=ws://openclaw-v5t3-openclaw-1:18789
OPENCLAW_GATEWAY_TOKEN=          # from existing .env

# OpenRouter
OPENROUTER_API_KEY=              # from existing .env

# Google Drive (service account JSON, base64 encoded)
GOOGLE_SERVICE_ACCOUNT_JSON_B64=
GOOGLE_DRIVE_STG_FOLDER_ID=
GOOGLE_DRIVE_PERSONAL_FOLDER_ID=
GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID=
GOOGLE_DRIVE_MC_BRIEFS_FOLDER_ID=

# Auth
MC_ADMIN_PASSWORD_HASH=          # argon2 hash, generate with scripts/hash-password.ts
MC_TOTP_SECRET=                  # base32, generate with scripts/gen-totp.ts

# Network
MC_ALLOWED_HOSTS=127.0.0.1
PORT=3100
HOST_AGENT_URL=http://host.docker.internal:3101

# App
NEXT_PUBLIC_AGENT_NAME=WintermuteTuring
NEXT_PUBLIC_TIMEZONE=America/Chicago
```

---

## Known OpenClaw Config (do not hardcode — read from openclaw.json)

```
Agent ID:    wintermute
Telegram:    configured in openclaw.json (do not commit bot token or UID)
Delivery:    use env var TELEGRAM_DELIVERY_UID for the Telegram target UID
Models:      openrouter/moonshotai/kimi-k2-0905 (default)
             openrouter/anthropic/claude-haiku-4-5 (heartbeat)
```

Cron IDs (from openclaw.json — verify on load, don't hardcode):
```
51d8a322  heartbeat            0 5 * * *
76114cf6  reddit-signal-scan   0 6 * * *
bb9599ba  reddit-engagement-brief  0 7 * * *
aec5f855  weekly-research-digest   0 17 * * 0
63530884  competitor-changelog-monitor  0 7 * * 1
19f6e1bd  competitor-review-scrape  0 8 1,15 * *
```

Cron IDs are non-sensitive (random hex, not credentials). Safe to commit.

---

## Google Drive Folder Structure

```
STG-Intelligence/     ← Wintermute writes research; Claude reads
Task-Specs/           ← Claude/Zack writes task briefs; Wintermute reads
Personal/             ← Wintermute writes personal deliverables
MC-Briefs/            ← Dashboard writes Claude context briefs (new)
```

Folder IDs come from environment variables. Never hardcode Drive folder IDs.

---

## Data Sources by Module

| Module | Primary Source | Fallback |
|---|---|---|
| Agent status | Gateway WebSocket | openclaw.json (static) |
| Cron list/status | Gateway API | openclaw.json |
| Cost data | OpenRouter /api/v1/usage | SQLite sessions + price table |
| Token counts | OpenClaw SQLite (sessions DB) | Gateway API |
| Task board | Local SQLite (mc.db) | None |
| Workspace files | /openclaw mount (read-only) | None |
| VPS metrics | Host agent :3101 | None (show unavailable) |
| Drive content | Google Drive API | None (show unavailable) |

OpenClaw SQLite location: `/openclaw/db/` — discover by listing the directory,
do not hardcode filenames as they may change between OpenClaw versions.

---

## Module Build Order

Build in this sequence. Each session should complete one row.

| Session | Module(s) | Gate |
|---|---|---|
| 0 | Scaffold: auth, Docker, Nginx, empty shells | Login page loads, Docker runs |
| 1 | Module 7: VPS Health | Live metrics visible |
| 2 | Module 3: Cost & Token Tracking | Charts render with real data |
| 3 | Module 2: Cron Manager | All 6 crons visible, trigger works |
| 4 | Module 6: Workspace & Memory | File browser reads /openclaw |
| 5 | Module 4: Task Board | Cards persist across page reload |
| 6 | Module 5: Claude Integration Loop | Brief writes to Drive |
| 7 | Module 1: Command Center (agent cards + feed) | Multi-agent layout works |
| 8 | Polish: error boundaries, audit log, mobile | All lint + typecheck clean |

---

## License & Copyright

This project is licensed under the MIT License. The `LICENSE` file in the
repo root is the authoritative copy.

### Source file headers

Every source file you create must begin with this copyright header,
adapted to the file's comment syntax. The year should reflect the year
the file was first created; do not update it on subsequent edits.

**TypeScript / JavaScript (`.ts`, `.tsx`, `.js`, `.mjs`):**
```typescript
// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT
```

**CSS / SCSS:**
```css
/* Copyright (c) 2026 Zack Schwenk */
/* SPDX-License-Identifier: MIT */
```

**Shell scripts (`.sh`):**
```bash
# Copyright (c) 2026 Zack Schwenk
# SPDX-License-Identifier: MIT
```

**JSON, YAML, TOML, and other config files:** No header required.
These formats either don't support comments or the header adds noise
with no practical benefit (LICENSE covers the whole repo).

**Markdown files:** No header required.

### Rules

- Add the header as the very first lines of the file — before imports,
  before `'use client'`, before anything else.
- Do not add a header to files copied verbatim from third-party sources
  (e.g., a vendored utility). Leave their original license header intact.
- Do not add a header to auto-generated files (`.next/`, `dist/`,
  `node_modules/`). These are gitignored and not source files.
- The `SPDX-License-Identifier` tag is machine-readable and used by
  GitHub's dependency graph and license scanners. Always include it
  exactly as shown.

---

## Coding Standards

### TypeScript

- **Strict mode is non-negotiable.** `tsconfig.json` has `strict: true`,
  `noUncheckedIndexedAccess: true`, `noImplicitReturns: true`. Do not add
  `@ts-ignore` or `@ts-expect-error` suppressions. If the type system is
  fighting you, fix the types — don't suppress them.
- **No `any`.** Use `unknown` for values of unknown shape and narrow with
  type guards. If a third-party library forces `any`, isolate it behind a
  typed wrapper function in `src/lib/`.
- **Explicit return types on all exported functions.** Inferred return types
  are acceptable for internal helpers but required for anything in `src/lib/`
  or `src/app/api/`.
- **`undefined` over `null` for optional values** unless an API or library
  specifically requires `null`.
- **Use `const` by default.** Only use `let` when reassignment is genuinely
  needed. Never use `var`.
- **Destructure function parameters** when a function takes more than two
  arguments. Use an options object with a named type.

---

### Comments

**What to comment:**
- **Why, not what.** Code should be self-explanatory about what it does.
  Comments explain intent, constraints, and non-obvious decisions.
- **Every exported function in `src/lib/`** gets a JSDoc block:
  ```typescript
  /**
   * Fetches daily cost data from the OpenRouter usage API.
   * Caches results for 15 minutes to avoid hammering the API on every page load.
   * Falls back to an empty array on 401/403 — treat as "not configured" not error.
   */
  export async function getOpenRouterDailyCosts(days: number): Promise<DailyAgentCost[]>
  ```
- **Security decisions** get an inline comment explaining the threat they
  address:
  ```typescript
  // Path traversal protection: resolve the full path and verify it starts
  // with the allowed base directory before reading any file.
  const resolved = path.resolve(WORKSPACE_DIR, relativePath);
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    throw new Error('Path traversal attempt rejected');
  }
  ```
- **REQUIRES_GATEWAY** marker on any code path that needs a live Gateway:
  ```typescript
  // REQUIRES_GATEWAY — returns empty array in dev/fixture mode
  ```
- **TODO comments** are acceptable but must include a session reference:
  ```typescript
  // TODO(session-7): wire to real Gateway SSE once WebSocket bridge is built
  ```

**What NOT to comment:**
- Don't comment obvious code (`// increment counter`, `// return result`)
- Don't leave commented-out code in commits. Delete it; git history preserves it.
- Don't add section dividers with `// ===...===` banners — use file/module
  structure to organize instead.

---

### File and Module Organization

- **One concern per file.** A lib file that grows beyond ~200 lines is a signal
  to split it.
- **Barrel exports (`index.ts`) only at the `src/lib/` level** — not inside
  `components/` or `app/`. Direct imports are easier to trace.
- **Co-locate tests with source** when writing them:
  `src/lib/cost.test.ts` alongside `src/lib/cost.ts`.
- **API routes follow REST conventions:**
  - `GET` for reads, `POST` for creates, `PUT` for full updates, `PATCH` for
    partial updates, `DELETE` for removal.
  - Return consistent JSON shapes: `{ data: T }` for success,
    `{ error: string, code?: string }` for errors.
  - Always return appropriate HTTP status codes. Never return 200 with an
    error body.

---

### Error Handling

- **Never swallow errors silently.** Every `catch` block must either:
  - Re-throw (let the caller handle it), or
  - Log and return a typed error response, or
  - Render an error state in the UI.
  A `catch` block with only a comment or empty body is a bug.
- **API routes use a consistent error response shape:**
  ```typescript
  // In src/lib/api-response.ts — create this helper in Session 0
  export function errorResponse(message: string, status: number, code?: string) {
    return Response.json({ error: message, code }, { status });
  }
  ```
- **Client-side errors surface in the UI, not just the console.** Every
  module panel has an error boundary. Within that, data-fetching hooks return
  `{ data, error, loading }` and the component renders the error state.
- **Distinguish error types explicitly:**
  - `400` — bad input from the client
  - `401` — not authenticated
  - `403` — authenticated but not authorized (failed TOTP)
  - `404` — resource not found
  - `500` — unexpected server error
  - `503` — upstream dependency unavailable (Gateway offline, Drive unreachable)

---

### Secure Coding Practices

**Input validation:**
- Validate all API route inputs with a schema before use. Use TypeScript's
  type system plus manual checks — do not trust `req.body` types.
- Validate query parameters are within expected ranges (e.g., `days` is a
  positive integer ≤ 365) before passing to data functions.
- For any input used in a file path, shell command, or SQL query, validate
  and sanitize explicitly — do not rely on the downstream function to catch it.

**Path traversal prevention** (repeat of OPSEC but important enough to
state here too):
```typescript
const WORKSPACE_DIR = path.resolve(process.env['OPENCLAW_DIR'] ?? '/openclaw', 'workspace');

function safeResolvePath(relativePath: string): string {
  // Reject paths containing '..' before resolution as an early signal
  if (relativePath.includes('..')) throw new Error('Invalid path');
  const resolved = path.resolve(WORKSPACE_DIR, relativePath);
  if (!resolved.startsWith(WORKSPACE_DIR + path.sep)) {
    throw new Error('Path traversal attempt rejected');
  }
  return resolved;
}
```

**SQL injection prevention:**
- Use `better-sqlite3` prepared statements for all queries. Never interpolate
  user input into SQL strings.
  ```typescript
  // Correct
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const task = stmt.get(id);

  // Never do this
  const task = db.prepare(`SELECT * FROM tasks WHERE id = '${id}'`).get();
  ```

**Shell command injection prevention:**
- The read-only terminal and host agent both execute shell commands. Always
  use a whitelist of exact commands — never interpolate user input into a
  command string. Use `execFile` (not `exec`) with an args array:
  ```typescript
  // Correct — execFile with separate args array
  execFile('df', ['-h'], { timeout: 3000 }, callback);

  // Never do this
  exec(`df -h ${userInput}`, callback);
  ```

**Authentication checks on every write route:**
- Every API route that mutates state must call `validateTotpFromRequest()`
  and return `403` immediately if it fails. Add a check at the top of
  the handler — do not let business logic run first.
  ```typescript
  export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return errorResponse('Unauthorized', 401);
    if (!validateTotpFromRequest(request)) return errorResponse('TOTP required', 403);
    // ... business logic
  }
  ```

**Dependency hygiene:**
- Run `pnpm audit` at the end of Session 0 and again at Session 8.
  Address any high or critical severity findings before shipping.
- Pin exact versions in `package.json` for security-sensitive packages
  (`argon2`, `otplib`, `jose`, `better-sqlite3`). Use `^` only for
  dev tooling.

**Content Security Policy:**
- The `next.config.ts` sets security headers. Do not weaken them.
  Specifically: never add `unsafe-inline` or `unsafe-eval` to CSP directives.
  If a library requires these, it is the wrong library — flag it and find
  an alternative.

**Logging:**
- Log security events (failed logins, failed TOTP, rejected path traversal
  attempts) to the audit log table via `src/lib/db.ts`.
- Never log secrets, tokens, or full request bodies to `console` or any
  log sink.
- Prefer structured log lines over free-form strings:
  ```typescript
  console.error('[auth] login failed', { ip, reason: 'invalid-password', ts: Date.now() });
  ```

---

### React & Next.js Conventions

- **Server Components by default.** Only add `'use client'` when genuinely
  needed (event handlers, browser APIs, stateful hooks). Justify with a
  comment when you do.
- **Data fetching in Server Components or Route Handlers** — not in
  `useEffect`. `useEffect` data fetching is a last resort for real-time
  client-side subscriptions (SSE, WebSocket) only.
- **Loading and error states are not optional.** Every component that fetches
  data must handle `loading` and `error` states explicitly — not with a
  spinner that never resolves or a silent empty render.
- **No inline styles.** Use Tailwind utility classes. If a value can't be
  expressed in Tailwind, use a CSS variable in `globals.css`.
- **Component naming:** PascalCase for components, camelCase for hooks
  (`useAgentStatus`), kebab-case for files (`agent-status-card.tsx`).
- **Props interfaces** are defined immediately above the component they
  belong to, not in a separate types file (unless shared across multiple
  components, in which case `src/types/index.ts`).

---

## Testing Requirements

- Run `pnpm typecheck && pnpm lint` before declaring any module complete.
- Unit tests for pure functions only (cost calculations, cron parsing, brief
  assembly). No e2e tests — they require a live Gateway.
- Any code path that requires a live Gateway connection must be clearly marked
  with a `// REQUIRES_GATEWAY` comment and have a mock fallback for dev mode.
- Dev mode (`NODE_ENV=development`) should work without Gateway, Drive, or
  host agent — use fixture data from `/mission-control/fixtures/`.

---

## File Structure

```
wintermute-agent/                    ← repo root
├── CLAUDE.md                        ← this file
├── SPEC.md                          ← full feature specification
├── docker-compose.sidecar.yml       ← MC sidecar, append to existing stack
├── nginx/
│   └── mission-control.conf         ← Nginx vhost config
├── session-prompts/                 ← per-session Claude Code prompts
│   ├── SESSION-0-scaffold.md
│   ├── SESSION-1-vps-health.md
│   └── ...
├── mission-control/                 ← Next.js app
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── .env.example
│   ├── fixtures/                    ← dev mock data
│   ├── scripts/                     ← setup utilities
│   │   ├── hash-password.ts
│   │   └── gen-totp.ts
│   └── src/
│       ├── app/
│       │   ├── (auth)/login/
│       │   ├── (dashboard)/
│       │   │   ├── layout.tsx       ← sidebar + topbar shell
│       │   │   ├── page.tsx         ← command center
│       │   │   ├── crons/
│       │   │   ├── costs/
│       │   │   ├── tasks/
│       │   │   ├── workspace/
│       │   │   ├── claude-loop/
│       │   │   └── vps-health/
│       │   └── api/
│       │       ├── auth/
│       │       ├── gateway/
│       │       ├── events/
│       │       ├── crons/
│       │       ├── costs/
│       │       ├── tasks/
│       │       ├── workspace/
│       │       ├── drive/
│       │       └── vps/
│       ├── components/
│       │   ├── ui/                  ← primitives (button, card, badge, etc.)
│       │   ├── layout/              ← sidebar, topbar, status strip
│       │   └── modules/             ← one folder per dashboard module
│       ├── lib/
│       │   ├── auth.ts
│       │   ├── db.ts
│       │   ├── gateway.ts
│       │   ├── drive.ts
│       │   ├── cost.ts
│       │   └── openclaw.ts          ← openclaw.json parser
│       └── types/
│           └── index.ts             ← shared TypeScript types
└── mission-control-host-agent/      ← tiny Node HTTP server for /proc reads
    ├── package.json
    ├── index.ts
    └── README.md
```

---

## What NOT to Build

These were explicitly decided against. Do not implement them, do not suggest
them inline — add to SUGGESTIONS.md if you think they're worth revisiting.

- 3D office / voxel agent visualization
- Multi-user / team support
- Hosted or cloud deployment option
- ClawHub skill browser
- Agent-to-agent messaging UI
- Mobile app (responsive web is sufficient)
- Electron / Tauri desktop wrapper
- Any analytics that phones home

---

## Session Handoff Protocol

At the end of each session:

1. Run `pnpm typecheck && pnpm lint` and fix all errors.

2. Run the pre-commit secret scan:
   ```bash
   git diff --cached | grep -iE "(api_key|token|secret|password|hash|Bearer|sk-|pk-)" && echo "STOP — potential secret in diff" || echo "clean"
   ```
   Do not commit if it triggers.

3. Create or update `SESSION-STATE-MC.md` in the repo root with:
   - What was completed this session
   - What is incomplete or blocked
   - Any decisions made that deviate from SPEC.md (with rationale)
   - Exact command to resume next session
   - A `## FORWARD-IMPACT` section listing any decisions that affect future
     session prompts, formatted as:
     ```
     ## FORWARD-IMPACT
     Session N: [what needs to change in that session prompt and why]
     ```

4. Commit everything:
   ```bash
   git add -A
   git commit -m "mc: [module] [what was done]"
   ```
   Note: `SESSION-STATE-MC.md` is gitignored and will not be committed.
   That is correct — it contains operational state and stays local only.

---

## Claude + Zack Sync Protocol

`SESSION-STATE-MC.md` is also the sync artifact between Zack and Claude
(claude.ai). It is not committed to git — it is shared by paste.

**At the start of every Claude session**, paste SESSION-STATE-MC.md into
the conversation. Claude will:
- Treat it as ground truth over the original SPEC.md where they conflict
- Flag if any answer assumes spec-as-written vs. what was actually built
- Update forward session prompts based on FORWARD-IMPACT items before
  you hand off to Claude Code

For larger deviations (entire module restructured, dependency swapped,
security model changed), also paste the relevant updated source file.
Claude will confirm whether it affects downstream sessions before proceeding.

---

## On Ambiguity

If the spec is ambiguous on a UI detail, choose the simpler option and note it
in SESSION-STATE-MC.md. Do not halt for clarification on visual decisions.

If the spec is ambiguous on an architectural or security decision, halt and
write the question to SESSION-STATE-MC.md under "BLOCKED — needs decision".
Do not guess on security.
