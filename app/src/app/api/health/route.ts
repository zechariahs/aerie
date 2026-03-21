// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/** Used by Docker healthcheck — no auth required. */
export function GET(): Response {
  return Response.json({ ok: true }, { status: 200 });
}
