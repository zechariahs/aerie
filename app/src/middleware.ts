// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/** Routes that do not require an active session. */
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout', '/api/health']);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Generate a nonce for CSP — each request gets a unique value
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');

  const isDev = process.env.NODE_ENV === 'development';

  // In dev, allow unsafe-eval so Next.js hot reload works.
  // In production, use strict-dynamic with nonces — no unsafe-inline anywhere.
  const scriptSrc = isDev
    ? `'self' 'unsafe-eval' 'nonce-${nonce}'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');

  // Auth guard — unauthenticated requests to protected routes → /login
  // API routes get a 401 JSON response instead of an HTML redirect so that
  // fetch/EventSource callers receive a machine-readable error (not a login page).
  if (!isPublicPath(pathname)) {
    const session = await getSession(request);
    if (!session) {
      if (pathname.startsWith('/api/')) {
        return new NextResponse('Unauthorized', { status: 401 });
      }
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      const response = NextResponse.redirect(loginUrl);
      response.headers.set('Content-Security-Policy', csp);
      return response;
    }
  }

  const response = NextResponse.next({
    request: {
      headers: new Headers({
        ...Object.fromEntries(request.headers),
        'x-nonce': nonce,
      }),
    },
  });

  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  // Run on all paths except Next.js internals and static files.
  // '/' explicitly covers the basePath root (/aerie and /aerie/);
  // the second pattern uses .+ so it only applies to non-empty sub-paths.
  matcher: ['/', '/((?!_next/static|_next/image|favicon.ico).+)'],
};
