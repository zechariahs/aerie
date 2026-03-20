# SESSION 0 — Scaffold

## FIRST THING: Create .gitignore before any other file

The repo is public. Before writing any other code, create `.gitignore`
at the repo root AND `mission-control/.gitignore`. Do this before the
first `git add` of any kind.

Root `.gitignore` (repo root):
```
# Environment — never commit these
.env
.env.local
.env.production
.env.*.local
*.env
mission-control/.env.production
mission-control/.env.local

# Operational state — local only, not for public repo
SESSION-STATE-MC.md
DEPENDENCY-DECISION-*.md

# Data
/app/data/
*.db
*.db-shm
*.db-wal

# Build artifacts
node_modules/
.next/
dist/
mission-control-host-agent/dist/

# OS
.DS_Store
Thumbs.db
```

`mission-control/.gitignore`:
```
.env
.env.local
.env.production
.env.*.local
.next/
node_modules/
*.db
```

Verify before any commit: `git check-ignore -v .env.production`
Expected output: `.gitignore:2:.env.production`
If it does not output that line, fix `.gitignore` before proceeding.

Also add a pre-commit hook at `.git/hooks/pre-commit`:
```bash
#!/bin/sh
# Scan staged files for potential secrets
if git diff --cached | grep -qiE "(api_key|_token|_secret|password_hash|Bearer [a-zA-Z0-9]|sk-[a-zA-Z0-9]|pk-[a-zA-Z0-9])"; then
  echo "ERROR: Potential secret detected in staged changes."
  echo "Review with: git diff --cached"
  echo "If intentional, use: git commit --no-verify (not recommended)"
  exit 1
fi
```
```bash
chmod +x .git/hooks/pre-commit
```

---

## Goal
Get Mission Control to a running state: login page loads, Docker runs, Nginx
config is in place, all dashboard page shells exist (empty but routable).

## Scope — build exactly these things, nothing else:
1. `pnpm install` — verify all dependencies resolve
2. Auth flow end-to-end:
   - `/app/(auth)/login/page.tsx` — login form (password + TOTP)
   - `/app/api/auth/login/route.ts` — POST handler (verify password, verify TOTP, set session cookie)
   - `/app/api/auth/logout/route.ts` — POST handler (clear cookie)
   - `/app/api/health/route.ts` — GET, returns `{ ok: true }` (used by Docker healthcheck)
   - `src/lib/auth.ts` already exists — use it, do not rewrite it
3. Middleware: `src/middleware.ts` — redirect unauthenticated requests to /login
4. Dashboard shell:
   - `/app/(dashboard)/layout.tsx` — sidebar nav + persistent top status strip (static/empty for now)
   - One empty `page.tsx` for each route: `/`, `/crons`, `/costs`, `/tasks`, `/workspace`, `/claude-loop`, `/vps-health`
   - Each empty page should render: `<h1>[Module Name]</h1><p>Coming soon.</p>`
5. Scripts:
   - `scripts/hash-password.ts` — takes argv[2] as plain password, prints argon2 hash
   - `scripts/gen-totp.ts` — generates a new base32 TOTP secret, prints it + the otpauth URI
6. `src/lib/db.ts` already exists — call `getDb()` at app startup to run migrations
7. Verify Docker build succeeds: `docker build -t mc-wintermute:latest .`

## Stopping condition
- `pnpm typecheck && pnpm lint` pass with zero errors
- `node scripts/hash-password.ts testpass` prints a valid argon2 hash
- `docker build` completes without error
- Navigating to `/login` renders a form
- Navigating to `/` (unauthenticated) redirects to `/login`
- Write SESSION-STATE-MC.md with what was completed and what's next

## Do not build:
- Any real data fetching (Gateway, Drive, VPS metrics) — that's Sessions 1–7
- Any UI styling beyond functional — polish is Session 8
- Any modules beyond the empty shells listed above

## Notes:
- `jose` is already in package.json for JWT — use it in auth.ts (already scaffolded)
- Session cookie: HttpOnly, SameSite=Strict, Secure (set Secure=false in dev)
- TOTP entry on the login form: after correct password, show TOTP input step
- Rate limit login attempts: 5 per 15 min per IP (use a simple in-memory Map for now)
