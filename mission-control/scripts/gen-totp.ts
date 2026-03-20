// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT
//
// Usage: pnpm tsx scripts/gen-totp.ts
// Generates a new base32 TOTP secret and prints the otpauth:// URI.
// Store the secret in MC_TOTP_SECRET and scan the URI with your authenticator app.

import { authenticator } from 'otplib';

const agentName = process.env['NEXT_PUBLIC_AGENT_NAME'] ?? 'MissionControl';

const secret = authenticator.generateSecret(32);
const uri = authenticator.keyuri('admin', agentName, secret);

console.log('Secret (set as MC_TOTP_SECRET):');
console.log(secret);
console.log('');
console.log('otpauth URI (scan with authenticator app):');
console.log(uri);
