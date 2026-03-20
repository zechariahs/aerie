// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Returns a JSON error response with a consistent shape.
 * Use this for all API route error paths.
 */
export function errorResponse(
  message: string,
  status: number,
  code?: string,
): Response {
  return Response.json({ error: message, code }, { status });
}

/**
 * Returns a JSON success response with a consistent shape.
 * Use this for all API route success paths.
 */
export function successResponse<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}
