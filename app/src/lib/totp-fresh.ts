// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Returns true if the mc_totp_ts cookie indicates that TOTP was verified
 * within the last 30 minutes. The cookie is non-HttpOnly and set by the server
 * whenever TOTP is successfully validated (login or write operation).
 *
 * When this returns true, write API calls may omit the X-TOTP-Token header —
 * the server will accept them based on the in-memory session grace record.
 * The client should pass an empty string as the token in that case.
 */
export function isTotpFresh(): boolean {
  if (typeof document === 'undefined') return false;
  const match = document.cookie.match(/(?:^|;\s*)mc_totp_ts=(\d+)/);
  if (!match) return false;
  return Date.now() - Number(match[1]) < 30 * 60 * 1000;
}
