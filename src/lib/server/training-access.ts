/**
 * Training access for public sessions: an operator-issued access code exchanges
 * for an expiring, server-checked session cookie.
 *
 * State is held in this server process only. Restarting the server ends every
 * session; running several server instances is unsupported because sessions and
 * attempt counters are not shared between processes.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { ApiError } from './api-error';
import {
  ACCESS_CODE_MAX_LENGTH,
  normalizeAccessCode,
  type ServerConfig,
} from './server-config';

export const SESSION_COOKIE = 'gg_training_session';

export const ATTEMPT_LIMITS = {
  /** Failed code entries allowed per client address within the window. */
  CLIENT_FAILURES: 5,
  CLIENT_WINDOW_MS: 10 * 60_000,
  /**
   * Failed code entries allowed across all clients within the window. Client
   * addresses come from a header the client can set, so this bound is the one
   * that holds against address spoofing.
   */
  HOST_FAILURES: 30,
  HOST_WINDOW_MS: 60_000,
} as const;

interface TrainingSession {
  expiresAt: number;
  /** Ties the session to the access code that issued it; rotating the code invalidates it. */
  codeFingerprint: Buffer;
}

interface FailureWindow {
  count: number;
  resetAt: number;
}

interface TrainingAccessState {
  secret: Buffer;
  sessions: Map<string, TrainingSession>;
  clientFailures: Map<string, FailureWindow>;
  hostFailures: FailureWindow;
}

const STATE_KEY = Symbol.for('geolocation-guesser.training-access');
type StateHolder = { [STATE_KEY]?: TrainingAccessState };

function newState(): TrainingAccessState {
  return {
    secret: randomBytes(32),
    sessions: new Map(),
    clientFailures: new Map(),
    hostFailures: { count: 0, resetAt: 0 },
  };
}

/** Process-wide state, kept on globalThis so every route bundle shares one instance. */
function state(): TrainingAccessState {
  const holder = globalThis as StateHolder;
  return (holder[STATE_KEY] ??= newState());
}

/** Discards all sessions and attempt counters held by this process. */
export function resetTrainingAccessState(): void {
  (globalThis as StateHolder)[STATE_KEY] = newState();
}

function fingerprint(code: string): Buffer {
  return createHmac('sha256', state().secret).update(code).digest();
}

function sessionIdFrom(request: NextRequest): string | null {
  const value = request.cookies.get(SESSION_COOKIE)?.value;
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export type AccessResult = { mode: 'off' } | { mode: 'open'; expiresAt: number };

/**
 * Admits a paid request. In `off` mode (local use) every request is admitted;
 * otherwise a live session issued under the current access code is required.
 */
export function checkTrainingAccess(request: NextRequest, config: ServerConfig, now = Date.now()): AccessResult {
  const { mode, accessCode } = config.training;
  if (mode === 'off') return { mode: 'off' };
  if (mode === 'closed') {
    throw new ApiError(403, 'training_closed', 'Training is closed. AI analysis is unavailable.');
  }
  if (!accessCode) {
    throw new ApiError(503, 'training_unavailable', 'Training access is not configured. AI analysis is unavailable.');
  }

  const sessionId = sessionIdFrom(request);
  const session = sessionId ? state().sessions.get(sessionId) : undefined;
  const valid =
    session !== undefined &&
    session.expiresAt > now &&
    timingSafeEqual(session.codeFingerprint, fingerprint(accessCode.value));

  if (!valid) {
    if (sessionId) state().sessions.delete(sessionId);
    throw new ApiError(401, 'training_session_required', 'Enter the training access code to use AI analysis.');
  }
  return { mode: 'open', expiresAt: session.expiresAt };
}

function clientKey(request: NextRequest): string {
  return (request.headers.get('x-forwarded-for') ?? 'unknown').slice(0, 64);
}

function retryAfterSeconds(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

function assertNotThrottled(key: string, now: number): void {
  const s = state();
  if (s.hostFailures.resetAt > now && s.hostFailures.count >= ATTEMPT_LIMITS.HOST_FAILURES) {
    throw tooManyAttempts(retryAfterSeconds(s.hostFailures.resetAt, now));
  }
  const client = s.clientFailures.get(key);
  if (client && client.resetAt > now && client.count >= ATTEMPT_LIMITS.CLIENT_FAILURES) {
    throw tooManyAttempts(retryAfterSeconds(client.resetAt, now));
  }
}

function tooManyAttempts(retryAfter: number): ApiError {
  return new ApiError(429, 'too_many_attempts', 'Too many incorrect access codes. Try again later.', {
    retryAfterSeconds: retryAfter,
  });
}

function recordFailure(key: string, now: number): void {
  const s = state();
  if (s.hostFailures.resetAt <= now) s.hostFailures = { count: 0, resetAt: now + ATTEMPT_LIMITS.HOST_WINDOW_MS };
  s.hostFailures.count++;

  for (const [entryKey, entry] of s.clientFailures) {
    if (entry.resetAt <= now) s.clientFailures.delete(entryKey);
  }
  const client = s.clientFailures.get(key) ?? { count: 0, resetAt: now + ATTEMPT_LIMITS.CLIENT_WINDOW_MS };
  client.count++;
  s.clientFailures.set(key, client);
}

/** Exchanges an access code for a new session. The code itself is never stored or logged. */
export function startTrainingSession(
  request: NextRequest,
  code: unknown,
  config: ServerConfig,
  now = Date.now()
): { sessionId: string; expiresAt: number } {
  const { mode, accessCode, sessionTtlMinutes } = config.training;
  if (mode === 'off') {
    throw new ApiError(409, 'training_off', 'Training mode is off; no access code is needed.');
  }
  if (mode === 'closed') {
    throw new ApiError(403, 'training_closed', 'Training is closed.');
  }
  if (!accessCode) {
    throw new ApiError(503, 'training_unavailable', 'Training access is not configured.');
  }
  if (typeof code !== 'string' || code.length === 0 || code.length > ACCESS_CODE_MAX_LENGTH * 2) {
    throw new ApiError(400, 'invalid_access_code_format', 'Enter the access code provided for this training.');
  }

  const key = clientKey(request);
  assertNotThrottled(key, now);

  if (!timingSafeEqual(fingerprint(normalizeAccessCode(code)), fingerprint(accessCode.value))) {
    recordFailure(key, now);
    throw new ApiError(401, 'invalid_access_code', 'The access code is not valid.');
  }

  const s = state();
  for (const [id, session] of s.sessions) {
    if (session.expiresAt <= now) s.sessions.delete(id);
  }
  const sessionId = randomBytes(32).toString('base64url');
  const expiresAt = now + sessionTtlMinutes * 60_000;
  s.sessions.set(sessionId, { expiresAt, codeFingerprint: fingerprint(accessCode.value) });
  return { sessionId, expiresAt };
}

export function endTrainingSession(request: NextRequest): void {
  const sessionId = sessionIdFrom(request);
  if (sessionId) state().sessions.delete(sessionId);
}

/** Session state for the browser: whether access is required and whether this browser has it. */
export function describeTrainingAccess(request: NextRequest, config: ServerConfig, now = Date.now()) {
  const { mode, accessCode } = config.training;
  if (mode === 'off') return { mode: 'off' as const, active: true, expiresAt: null };
  if (mode === 'closed') return { mode: 'closed' as const, active: false, expiresAt: null };
  if (!accessCode) return { mode: 'unavailable' as const, active: false, expiresAt: null };
  try {
    const result = checkTrainingAccess(request, config, now);
    return { mode: 'open' as const, active: true, expiresAt: result.mode === 'open' ? result.expiresAt : null };
  } catch {
    return { mode: 'open' as const, active: false, expiresAt: null };
  }
}

function isSecureRequest(request: NextRequest): boolean {
  if (request.nextUrl.protocol === 'https:') return true;
  return request.headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase() === 'https';
}

export function setSessionCookie(response: NextResponse, request: NextRequest, sessionId: string, expiresAt: number, now = Date.now()) {
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'strict',
    path: '/',
    maxAge: Math.max(1, Math.floor((expiresAt - now) / 1000)),
  });
}

export function clearSessionCookie(response: NextResponse, request: NextRequest) {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
}
