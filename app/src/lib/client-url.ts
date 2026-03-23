// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * The Next.js basePath for this app (e.g. "/aerie").
 * Next.js does NOT automatically prepend basePath to fetch() calls —
 * only to Link and router.push(). All client-side fetch() calls must
 * use this constant when building API URLs.
 *
 * Set NEXT_PUBLIC_BASE_PATH in your environment to match next.config.ts basePath.
 */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
