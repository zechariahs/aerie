// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { type NextRequest } from 'next/server';
import {
  checkRateLimit,
  clearRateLimit,
  verifyPassword,
  createTempToken,
  verifyTempToken,
  validateTotpFromRequest,
  createSession,
  recordTotpVerified,
  setTotpFreshCookie,
} from '@/lib/auth';
import { errorResponse } from '@/lib/api-response';
import { writeAuditLog, getDb } from '@/lib/db';

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
}

export async function POST(request: NextRequest): Promise<Response> {
  const ip = getClientIp(request);
  const ua = request.headers.get('user-agent') ?? '';

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (typeof body !== 'object' || body === null) {
    return errorResponse('Invalid request body', 400);
  }

  const { step } = body as Record<string, unknown>;

  // ── Step 1: password verification ──────────────────────────────────────────
  if (step === 'password') {
    const { password } = body as Record<string, unknown>;

    if (typeof password !== 'string' || password.length === 0) {
      return errorResponse('Password is required', 400);
    }

    if (!checkRateLimit(ip)) {
      writeAuditLog({ action: 'login.rate_limited', resource: '/api/auth/login', result: 'failure', ip, userAgent: ua });
      return errorResponse('Too many attempts — try again in 15 minutes', 429);
    }

    const valid = await verifyPassword(password);
    if (!valid) {
      writeAuditLog({ action: 'login.bad_password', resource: '/api/auth/login', result: 'failure', ip, userAgent: ua });
      // Deliberately vague error message to avoid user enumeration
      return errorResponse('Invalid credentials', 401);
    }

    const tempToken = await createTempToken();
    return Response.json({ nextStep: 'totp', tempToken }, { status: 200 });
  }

  // ── Step 2: TOTP verification ───────────────────────────────────────────────
  if (step === 'totp') {
    const { tempToken, totp } = body as Record<string, unknown>;

    if (typeof tempToken !== 'string' || typeof totp !== 'string') {
      return errorResponse('tempToken and totp are required', 400);
    }

    const tempPayload = await verifyTempToken(tempToken);
    if (!tempPayload) {
      writeAuditLog({ action: 'login.invalid_temp_token', resource: '/api/auth/login', result: 'failure', ip, userAgent: ua });
      return errorResponse('Session expired — start over', 401);
    }

    // Build a synthetic Request with the TOTP header for validateTotpFromRequest
    const syntheticRequest = new Request(request.url, {
      headers: { 'X-TOTP-Token': totp },
    });

    if (!validateTotpFromRequest(syntheticRequest)) {
      writeAuditLog({ action: 'login.bad_totp', resource: '/api/auth/login', result: 'failure', ip, userAgent: ua });
      return errorResponse('Invalid authenticator code', 403);
    }

    clearRateLimit(ip);
    // Read SESSION_DURATION_HOURS from settings so the DB value is honoured.
    // Done here rather than in session.ts to keep that file Edge-safe.
    const sessionDurationSeconds = readSessionDurationSeconds();
    const sessionSid = await createSession(sessionDurationSeconds);
    recordTotpVerified(sessionSid);
    await setTotpFreshCookie();

    writeAuditLog({ action: 'login.success', resource: '/api/auth/login', result: 'success', ip, userAgent: ua });

    return Response.json({ ok: true }, { status: 200 });
  }

  return errorResponse('Invalid step', 400);
}

/**
 * Reads SESSION_DURATION_HOURS from the settings table.
 * Returns the value in seconds, or undefined to fall back to the default 8-hour TTL.
 * Silently returns undefined on any DB error — login must not be blocked by a
 * missing or corrupt setting.
 */
function readSessionDurationSeconds(): number | undefined {
  try {
    const row = getDb()
      .prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'SESSION_DURATION_HOURS'`)
      .get();
    if (!row) return undefined;
    const hours = parseFloat(row.value);
    if (!isFinite(hours) || hours <= 0) return undefined;
    return Math.max(60, Math.floor(hours * 3600));
  } catch {
    return undefined;
  }
}
