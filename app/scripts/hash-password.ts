// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT
//
// Usage: pnpm tsx scripts/hash-password.ts <plaintext-password>
// Prints the argon2id hash to stdout. Store the result in MC_ADMIN_PASSWORD_HASH.

import argon2 from 'argon2';

async function main(): Promise<void> {
  const password = process.argv[2];

  if (!password) {
    console.error('Usage: pnpm tsx scripts/hash-password.ts <password>');
    process.exit(1);
  }

  const hash = await argon2.hash(password, { type: argon2.argon2id });
  console.log(hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
