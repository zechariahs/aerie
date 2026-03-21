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
const SESSION_DURATION_SECONDS = 8 * 60 * 60; // 8 hours

function getSecret(): Uint8Array {
  const secret = process.env['AUTH_SECRET'];
  if (!secret) throw new Error('AUTH_SECRET environment variable is not set');
  return new TextEncoder().encode(secret);
}

/**
 * Creates a full session JWT and sets it as an HttpOnly cookie.
 * Call this only after both password and TOTP are verified.
 */
export async function createSession(): Promise<void> {
  const token = await new SignJWT({ sub: 'admin' } satisfies Omit<SessionPayload, 'iat' | 'exp'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DURATION_SECONDS,
  });
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
