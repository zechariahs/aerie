// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { destroySession, getSession, clearTotpFreshCookie } from '@/lib/session';
import { writeAuditLog } from '@/lib/db';
import { type NextRequest } from 'next/server';

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
}

export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession(request);
  const ip = getClientIp(request);
  const ua = request.headers.get('user-agent') ?? '';

  if (session) {
    writeAuditLog({ action: 'logout', resource: '/api/auth/logout', result: 'success', ip, userAgent: ua });
  }

  await destroySession();
  await clearTotpFreshCookie();

  return Response.json({ ok: true }, { status: 200 });
}
