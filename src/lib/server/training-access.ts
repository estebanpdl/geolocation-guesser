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
import { clientAddress } from './client-address';
import {
  ACCESS_CODE_MAX_LENGTH,
  normalizeAccessCode,
  type ServerConfig,
} from './server-config';

export const SESSION_COOKIE = 'gg_training_session';

export const ATTEMPT_LIMITS = {
  /**
   * Wrong codes one client address can enter at once. A room on shared Wi-Fi
   * often reaches the server from a single address, so this absorbs a room's
   * typos instead of locking everyone out.
   */
  CLIENT_BURST: 20,
  /** After the burst, each address regains one wrong-code attempt per interval. */
  CLIENT_REFILL_MS: 15_000,
  /**
   * Failed code entries allowed across all clients within the window. This bound
   * holds even when client addresses are forged or not attributable.
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
  /** Per address: when its wrong-code allowance is fully restored. */
  clientRestoredAt: Map<string, number>;
  hostFailures: FailureWindow;
  /** The access code and operator reset the attempt counters belong to. */
  attemptsEpoch: Buffer | null;
}

const STATE_KEY = Symbol.for('geolocation-guesser.training-access');
type StateHolder = { [STATE_KEY]?: TrainingAccessState };

function newState(): TrainingAccessState {
  return {
    secret: randomBytes(32),
    sessions: new Map(),
    clientRestoredAt: new Map(),
    hostFailures: { count: 0, resetAt: 0 },
    attemptsEpoch: null,
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

function retryAfterSeconds(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

/**
 * Attempt counters apply to one access code and one operator reset. A new code
 * (rotation) or `auth training unlock` starts them afresh; sessions are untouched.
 */
function syncAttemptsEpoch(config: ServerConfig, accessCode: string): void {
  const s = state();
  const epoch = fingerprint(`${accessCode}\n${config.training.attemptsResetAt ?? ''}`);
  if (s.attemptsEpoch && s.attemptsEpoch.equals(epoch)) return;
  s.attemptsEpoch = epoch;
  s.clientRestoredAt.clear();
  s.hostFailures = { count: 0, resetAt: 0 };
}

/** The burst is spent once restoring the allowance would take longer than the burst minus one attempt. */
const CLIENT_BURST_SPAN_MS = (ATTEMPT_LIMITS.CLIENT_BURST - 1) * ATTEMPT_LIMITS.CLIENT_REFILL_MS;

function assertNotThrottled(key: string, now: number): void {
  const s = state();
  if (s.hostFailures.resetAt > now && s.hostFailures.count >= ATTEMPT_LIMITS.HOST_FAILURES) {
    throw tooManyAttempts(retryAfterSeconds(s.hostFailures.resetAt, now));
  }
  const restoredAt = s.clientRestoredAt.get(key);
  if (restoredAt !== undefined && restoredAt - now > CLIENT_BURST_SPAN_MS) {
    throw tooManyAttempts(retryAfterSeconds(restoredAt - CLIENT_BURST_SPAN_MS, now));
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

  for (const [entryKey, restoredAt] of s.clientRestoredAt) {
    if (restoredAt <= now) s.clientRestoredAt.delete(entryKey);
  }
  const restoredAt = Math.max(s.clientRestoredAt.get(key) ?? now, now);
  s.clientRestoredAt.set(key, restoredAt + ATTEMPT_LIMITS.CLIENT_REFILL_MS);
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

  syncAttemptsEpoch(config, accessCode.value);
  const key = clientAddress(request.headers, config.trustedProxyHops);
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
