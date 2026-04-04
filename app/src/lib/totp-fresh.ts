// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Returns true if the mc_totp_ts cookie indicates that TOTP was verified
 * within the last 30 minutes. The cookie is non-HttpOnly and set by the server
 * whenever TOTP is successfully validated (login or write operation).
 *
 * When this returns true, write API calls should send an empty string as the
 * X-TOTP-Token header value. The server treats an absent header and an empty
 * string identically (both are falsy in `validateTotpFromRequest`), and will
 * accept the request based on the in-memory session grace record.
 */

/** Must match TOTP_GRACE_MS in auth.ts. */
const TOTP_GRACE_MS = 30 * 60 * 1000; // 30 minutes

export function isTotpFresh(): boolean {
  if (typeof document === 'undefined') return false;
  const match = document.cookie.match(/(?:^|;\s*)mc_totp_ts=(\d+)/);
  if (!match) return false;
  const ts = Number(match[1]);
  if (!Number.isFinite(ts)) return false;
  const age = Date.now() - ts;
  return age >= 0 && age < TOTP_GRACE_MS;
}

/**
 * Removes the mc_totp_ts cookie from the browser.
 * Call when a server 403 reveals that the server-side grace period has expired
 * (e.g., after a process restart) so the UI can re-prompt for TOTP.
 */
export function clearTotpFreshCookieClient(): void {
  if (typeof document === 'undefined') return;
  document.cookie = 'mc_totp_ts=; Max-Age=0; path=/; SameSite=Strict';
}
