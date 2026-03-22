# Copyright (c) 2026 Zack Schwenk
# SPDX-License-Identifier: MIT

FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Copy native modules compiled in deps stage
COPY --from=deps /app/node_modules/.pnpm/better-sqlite3@11.9.1/node_modules/better-sqlite3/build ./node_modules/.pnpm/better-sqlite3@11.9.1/node_modules/better-sqlite3/build
COPY --from=deps /app/node_modules/.pnpm/argon2@0.43.0/node_modules/argon2/build ./node_modules/.pnpm/argon2@0.43.0/node_modules/argon2/build
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
USER nextjs
EXPOSE 3100
ENV PORT=3100
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
