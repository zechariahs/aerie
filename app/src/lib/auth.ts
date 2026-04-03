// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT
//
// Node.js-only auth helpers — argon2 and otplib are native modules that cannot
// run on the Edge runtime. Import from session.ts for edge-safe session operations.

import { timingSafeEqual } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { authenticator } from 'otplib';
import type { TempTokenPayload, SessionPayload } from '@/types';
import { getSession, setTotpFreshCookie } from './session';

export { createSession, destroySession, getSession, setTotpFreshCookie, clearTotpFreshCookie } from './session';

const TEMP_TOKEN_DURATION_SECONDS = 5 * 60; // 5 minutes

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** In-memory rate limiter keyed by IP. Resets on process restart. */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function getSecret(): Uint8Array {
  const secret = process.env['AUTH_SECRET'];
  if (!secret) throw new Error('AUTH_SECRET environment variable is not set');
  return new TextEncoder().encode(secret);
}

/**
 * Returns true if the IP is within the rate limit window.
 * Increments the attempt count on each call.
 */
export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;

  entry.count++;
  return true;
}

/** Clears the rate limit record for an IP after a successful login. */
export function clearRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

/**
 * Verifies a plain-text password against the stored argon2 hash.
 *
 * Reads MC_ADMIN_PASSWORD_HASH_B64 first (base64-encoded hash, safe from
 * Docker Compose $ interpolation), falling back to MC_ADMIN_PASSWORD_HASH
 * for local dev environments that set the hash directly.
 */
export async function verifyPassword(password: string): Promise<boolean> {
  const b64 = process.env['MC_ADMIN_PASSWORD_HASH_B64'];
  const hash = b64
    ? Buffer.from(b64, 'base64').toString('utf8')
    : process.env['MC_ADMIN_PASSWORD_HASH'];
  if (!hash) return false;

  // Dynamic import keeps argon2 (native module) isolated — avoids issues if
  // this file is ever imported from a code path analyzed by the Edge bundler.
  const argon2 = await import('argon2');
  return argon2.verify(hash, password);
}

/**
 * Creates a short-lived temp token issued after password verification.
 * The client must present this when submitting the TOTP step.
 */
export async function createTempToken(): Promise<string> {
  return new SignJWT({ sub: 'admin', step: 'totp' } satisfies Omit<TempTokenPayload, 'iat' | 'exp'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TEMP_TOKEN_DURATION_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Verifies the temp token and returns its payload, or null if invalid.
 */
export async function verifyTempToken(token: string): Promise<TempTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload['step'] !== 'totp') return null;
    return payload as unknown as TempTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Returns true if the request carries a valid agent API key.
 * Agents authenticate with: Authorization: Bearer <AGENT_API_KEY>
 * Used as an alternative to session + TOTP on task write endpoints.
 */
export function isAgentRequest(request: Request): boolean {
  const key = process.env['AGENT_API_KEY'];
  if (!key) return false;
  const auth = (request.headers.get('authorization') ?? '').trim();
  const expected = `Bearer ${key}`;
  if (auth.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Validates the TOTP token from the X-TOTP-Token request header.
 * Returns true only if the token matches the current or adjacent 30-second window.
 * Every write API route must call this before executing business logic.
 */
export function validateTotpFromRequest(request: Request): boolean {
  const token = request.headers.get('X-TOTP-Token');
  if (!token) return false;

  const secret = process.env['MC_TOTP_SECRET'];
  if (!secret) return false;

  // ±1 interval grace window (90-second total)
  authenticator.options = { window: 1 };

  return authenticator.verify({ token, secret });
}

// ── TOTP 30-minute grace period ───────────────────────────────────────────────

const TOTP_GRACE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * In-memory map: session sid (UUID) → Date.now() of last TOTP verification.
 * Keyed by the unique per-session `sid` claim to avoid iat-collision between
 * sessions created within the same second.
 * Resets on process restart, which is acceptable — users simply re-verify.
 * Expired entries are pruned opportunistically on reads and writes so the map
 * does not grow without bound.
 */
const totpTimestamps = new Map<string, number>();

function pruneExpiredTotpTimestamps(now: number): void {
  for (const [sid, verifiedAt] of totpTimestamps) {
    if (now - verifiedAt >= TOTP_GRACE_MS) {
      totpTimestamps.delete(sid);
    }
  }
}

/** Record that a TOTP code was successfully verified for this session. */
export function recordTotpVerified(sid: string): void {
  const now = Date.now();
  pruneExpiredTotpTimestamps(now);
  totpTimestamps.set(sid, now);
}

/** True if TOTP was verified for this session within the last 30 minutes. */
export function isSessionTotpFresh(sid: string): boolean {
  const now = Date.now();
  pruneExpiredTotpTimestamps(now);
  const ts = totpTimestamps.get(sid);
  if (ts === undefined) return false;
  if (now - ts >= TOTP_GRACE_MS) {
    totpTimestamps.delete(sid);
    return false;
  }
  return true;
}

type TotpAuthResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; status: 401 | 403 };

/**
 * Unified TOTP auth check for write routes.
 *
 * - If the session's TOTP was verified within the last 30 minutes, allows the
 *   request without requiring an X-TOTP-Token header.
 * - Otherwise, validates the header token. On success, records the verification
 *   and sets the mc_totp_ts cookie so the client can suppress the dialog.
 *
 * Returns { ok: true, session } on success, or { ok: false, status: 401|403 }.
 */
export async function requireTotpAuth(request: Request): Promise<TotpAuthResult> {
  const session = await getSession();
  if (!session) return { ok: false, status: 401 };

  if (isSessionTotpFresh(session.sid)) {
    return { ok: true, session };
  }

  if (!validateTotpFromRequest(request)) {
    return { ok: false, status: 403 };
  }

  recordTotpVerified(session.sid);
  await setTotpFreshCookie();
  return { ok: true, session };
}
