import { NextResponse } from 'next/server';

/**
 * An error whose status, code and message are safe to return to the browser.
 * `upstreamStatus` is kept for server logs only.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly upstreamStatus?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { upstreamStatus?: number; retryAfterSeconds?: number } = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.upstreamStatus = options.upstreamStatus;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function jsonResponse(body: Record<string, unknown>, requestId: string, init: ResponseInit = {}) {
  const response = NextResponse.json({ ...body, requestId }, init);
  response.headers.set('X-Request-Id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function errorResponse(err: unknown, requestId: string, route: string) {
  const apiError =
    err instanceof ApiError
      ? err
      : new ApiError(500, 'internal_error', 'The request could not be completed.');

  logRouteError(route, requestId, err, apiError);

  const response = jsonResponse(
    { error: apiError.message, code: apiError.code },
    requestId,
    { status: apiError.status }
  );
  if (apiError.retryAfterSeconds !== undefined) {
    response.headers.set('Retry-After', String(apiError.retryAfterSeconds));
  }
  return response;
}

/**
 * Logs only fixed metadata. Upstream messages, URLs, request bodies, image data,
 * credentials and access codes never reach the log.
 */
function logRouteError(route: string, requestId: string, original: unknown, apiError: ApiError) {
  const fields = [
    `route=${route}`,
    `requestId=${requestId}`,
    `status=${apiError.status}`,
    `code=${apiError.code}`,
  ];
  if (apiError.upstreamStatus !== undefined) fields.push(`upstreamStatus=${apiError.upstreamStatus}`);
  if (!(original instanceof ApiError)) fields.push(`errorType=${errorTypeName(original)}`);

  const line = `API request failed: ${fields.join(' ')}`;
  if (apiError.status >= 500) console.error(line);
  else console.warn(line);
}

function errorTypeName(value: unknown): string {
  if (value instanceof Error) return value.name.replace(/[^\w.-]/g, '').slice(0, 64) || 'Error';
  return typeof value;
}
