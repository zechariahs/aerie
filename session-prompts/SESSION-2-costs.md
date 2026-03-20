# SESSION 2 — Module 3: Cost & Token Tracking

## Prerequisite
Session 1 complete. VPS health page works.

## Goal
Implement the Cost & Token Tracking page (`/costs`) with real data from
OpenRouter API and OpenClaw SQLite, plus the price table editor.

## Scope

### Data layer: `src/lib/cost.ts` (create this file)

```typescript
// Functions to implement:

// 1. Fetch daily cost data from OpenRouter
// GET https://openrouter.ai/api/v1/usage?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Auth: Bearer OPENROUTER_API_KEY
// Cache response for 15 minutes in memory
async function getOpenRouterDailyCosts(days: number): Promise<DailyAgentCost[]>

// 2. Read token counts from OpenClaw SQLite
// Discover the sessions DB by listing /openclaw/db/ and finding *.db files
// Query: sessions table (discover schema by reading sqlite_master)
// Map agent IDs from openclaw.json config
function getSessionCostsFromSqlite(days: number): DailyAgentCost[]

// 3. Merge sources — OpenRouter takes priority, SQLite+price table as fallback
function getMergedCosts(days: number): Promise<DailyAgentCost[]>

// 4. Load/save price table from /app/data/price-table.json
function loadPriceTable(): ModelPrice[]
function savePriceTable(table: ModelPrice[]): void

// 5. Compute cost from tokens + price table
function computeCost(inputTokens: number, outputTokens: number, modelId: string, priceTable: ModelPrice[]): number
```

Pre-populate `price-table.json` with known OpenRouter models:
- `openrouter/moonshotai/kimi-k2-0905`: input $0.15, output $2.00 per 1M
- `openrouter/anthropic/claude-haiku-4-5`: input $0.80, output $4.00 per 1M
- `openrouter/anthropic/claude-sonnet-4-5`: input $3.00, output $15.00 per 1M

### API Routes
- `GET /api/costs/daily?days=30` — returns DailyAgentCost[]
- `GET /api/costs/sessions?agentId=&days=30&page=1&limit=50` — paginated session list
- `GET /api/costs/price-table` — returns ModelPrice[]
- `PUT /api/costs/price-table` — TOTP required, saves updated price table
- `GET /api/costs/summary` — returns { today, thisWeek, thisMonth, projectedMonth, vsLastMonth }

### Cost Page (`/costs/page.tsx`)
Five panels, each with error boundary:

**Panel 1 — Daily Spend Chart**
Recharts BarChart, last 30 days, stacked by model, x-axis = date, y-axis = USD
Hover tooltip: per-model breakdown + total

**Panel 2 — Per-Agent Summary**
Table: Agent | Today | This Week | This Month | Avg/Session | Sessions
Sparkline in "This Week" cell (7 data points)
Click row → filter session inspector to that agent

**Panel 3 — Per-Cron Summary**  
Table: Cron Name | Avg Tokens/Run | Avg Cost/Run | Total This Month | Runs
Sorted by Total This Month descending
Read cron list from openclaw.ts

**Panel 4 — Session Inspector**
Paginated table, newest first
Columns: Timestamp | Agent | Model | Input Tokens | Output Tokens | Cost | Duration | Source badge
Outlier rows (> 2σ above agent mean): amber background
Source badge: "OpenRouter" or "Estimated"

**Panel 5 — Monthly Projection**
Simple card: Current spend | Projected month-end | vs. last month (+/- %)

**Panel 6 — Price Table Editor**
Editable table: Model ID | Input $/1M | Output $/1M | Last Updated
"Add row" button at bottom
Save button (TOTP required)
Small note: "Used as fallback when OpenRouter data unavailable"

## Stopping condition
- `pnpm typecheck && pnpm lint` pass
- Cost page loads with all panels
- With `USE_FIXTURES=true`, charts render with fixture data
- Create `fixtures/costs.json` with synthetic 30-day data
- Write SESSION-STATE-MC.md
