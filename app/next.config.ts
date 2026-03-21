// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',

  // Prevent Next.js from walking up past the app directory when
  // tracing file dependencies — avoids the multiple-lockfiles workspace warning.
  outputFileTracingRoot: __dirname,

  // Native modules that must run in Node.js, not edge runtime
  serverExternalPackages: ['better-sqlite3', 'argon2'],

  // Host header validation — only accept requests for configured hosts
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
