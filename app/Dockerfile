# Copyright (c) 2026 Zack Schwenk
# SPDX-License-Identifier: MIT

# ── base: shared Node + pnpm setup ────────────────────────────────────────────
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# ── deps: install all dependencies including native module build tools ─────────
FROM base AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ── builder: compile Next.js app ──────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ── runner: minimal production image ──────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Copy full node_modules from deps so native binaries match the build environment
COPY --from=deps /app/node_modules ./node_modules
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
USER nextjs
EXPOSE 3100
ENV PORT=3100
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]