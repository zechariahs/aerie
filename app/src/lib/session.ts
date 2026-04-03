// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT
//
// Edge-safe session helpers — no native modules, safe to import in middleware.
// Password and TOTP verification (argon2, otplib) live in auth.ts (Node.js only).

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import type { SessionPayload } from '@/types';

const SESSION_COOKIE = 'mc_session';
const TOTP_COOKIE = 'mc_totp_ts';
const SESSION_DURATION_SECONDS = 8 * 60 * 60; // 8 hours
/** Must match TOTP_GRACE_MS in auth.ts (same duration, in seconds for cookie maxAge). */
const TOTP_GRACE_SECONDS = 30 * 60; // 30 minutes

function getSecret(): Uint8Array {
  const secret = process.env['AUTH_SECRET'];
  if (!secret) throw new Error('AUTH_SECRET environment variable is not set');
  return new TextEncoder().encode(secret);
}

/**
 * Creates a full session JWT and sets it as an HttpOnly cookie.
 * Call this only after both password and TOTP are verified.
 * Returns the session's iat (issued-at) timestamp so the caller can
 * immediately record TOTP verification for the new session.
 *
 * @param durationSeconds - Override the default 8-hour TTL. Sourced from
 *   the SESSION_DURATION_HOURS DB setting in the login route, which cannot
 *   read it here because this file must remain Edge-safe (no better-sqlite3).
 * @returns The unique session ID (`sid`) for the new session, used by the
 *   caller to record TOTP verification in the in-memory grace map.
 */
export async function createSession(durationSeconds?: number): Promise<string> {
  const ttl = durationSeconds ?? SESSION_DURATION_SECONDS;
  const sid = crypto.randomUUID();
  const token = await new SignJWT({ sub: 'admin', sid } satisfies Omit<SessionPayload, 'iat' | 'exp'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ttl,
  });

  return sid;
}

/**
 * Sets a non-HttpOnly cookie recording when TOTP was last verified.
 * Client-side JS can read this to decide whether to show the TOTP dialog.
 * The cookie is intentionally not a secret — it contains only a timestamp.
 */
export async function setTotpFreshCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(TOTP_COOKIE, String(Date.now()), {
    httpOnly: false,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TOTP_GRACE_SECONDS,
  });
}

/** Removes the TOTP-fresh cookie (call on logout). */
export async function clearTotpFreshCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(TOTP_COOKIE);
}

/**
 * Clears the session cookie. Call from the logout route handler.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Reads and verifies the session cookie.
 * Pass a NextRequest when calling from middleware; omit when calling from
 * a Server Component or Route Handler (reads from next/headers automatically).
 */
export async function getSession(
  request?: NextRequest,
): Promise<SessionPayload | null> {
  let token: string | undefined;

  if (request) {
    token = request.cookies.get(SESSION_COOKIE)?.value;
  } else {
    const cookieStore = await cookies();
    token = cookieStore.get(SESSION_COOKIE)?.value;
  }

  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
