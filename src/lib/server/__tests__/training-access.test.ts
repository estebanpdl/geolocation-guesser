// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api-error';
import { emptyStore, type TrainingMode } from '../credential-store';
import { resolveServerConfig } from '../server-config';
import {
  ATTEMPT_LIMITS,
  checkTrainingAccess,
  describeTrainingAccess,
  endTrainingSession,
  resetTrainingAccessState,
  SESSION_COOKIE,
  startTrainingSession,
} from '../training-access';
import { getRequest, SYNTHETIC } from '@/test/fakes';

const T0 = 1_700_000_000_000;

/** `accessCode: null` configures no code at all. */
function config(mode: TrainingMode, accessCode: string | null = SYNTHETIC.ACCESS_CODE, ttl = '60') {
  return resolveServerConfig(
    { TRAINING_SESSION_TTL_MINUTES: ttl },
    { status: 'ok', path: null, data: { ...emptyStore(), training: { mode, accessCode: accessCode ?? undefined } } }
  );
}

function request(sessionId?: string, client = '203.0.113.7') {
  const req = getRequest('/api/ai-analysis', sessionId ? `${SESSION_COOKIE}=${sessionId}` : undefined);
  req.headers.set('x-forwarded-for', client);
  return req;
}

function apiError(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected an ApiError');
}

beforeEach(() => resetTrainingAccessState());

describe('checkTrainingAccess', () => {
  it('admits every request when training mode is off', () => {
    expect(checkTrainingAccess(request(), config('off', null))).toEqual({ mode: 'off' });
  });

  it('blocks all requests while training is closed', () => {
    const open = config('open');
    const { sessionId } = startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0);
    const err = apiError(() => checkTrainingAccess(request(sessionId), config('closed'), T0));
    expect([err.status, err.code]).toEqual([403, 'training_closed']);
  });

  it('fails closed when training is open without a usable code', () => {
    expect(apiError(() => checkTrainingAccess(request(), config('open', null))).code).toBe('training_unavailable');
    expect(apiError(() => checkTrainingAccess(request(), config('open', 'short'))).code).toBe('training_unavailable');
  });

  it('requires a session cookie in open mode', () => {
    const err = apiError(() => checkTrainingAccess(request(), config('open'), T0));
    expect([err.status, err.code]).toEqual([401, 'training_session_required']);
    expect(apiError(() => checkTrainingAccess(request('x'.repeat(43)), config('open'), T0)).status).toBe(401);
  });

  it('admits a live session and rejects it after expiry', () => {
    const open = config('open');
    const { sessionId, expiresAt } = startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0);
    expect(expiresAt).toBe(T0 + 60 * 60_000);
    expect(checkTrainingAccess(request(sessionId), open, expiresAt - 1)).toEqual({ mode: 'open', expiresAt });
    expect(apiError(() => checkTrainingAccess(request(sessionId), open, expiresAt)).code).toBe('training_session_required');
    // The expired session is gone even if the clock were wound back.
    expect(apiError(() => checkTrainingAccess(request(sessionId), open, T0)).code).toBe('training_session_required');
  });

  it('invalidates sessions when the access code is rotated', () => {
    const { sessionId } = startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, config('open'), T0);
    const rotated = config('open', 'NEWCODE-9876');
    expect(apiError(() => checkTrainingAccess(request(sessionId), rotated, T0 + 1)).code).toBe('training_session_required');
  });

  it('places no limit on repeated or concurrent use of a session', async () => {
    const open = config('open');
    const { sessionId } = startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0);
    const results = await Promise.all(
      Array.from({ length: 200 }, async () => checkTrainingAccess(request(sessionId), open, T0 + 1))
    );
    expect(results.every((r) => r.mode === 'open')).toBe(true);
  });

  it('ends a session on request', () => {
    const open = config('open');
    const { sessionId } = startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0);
    endTrainingSession(request(sessionId));
    expect(apiError(() => checkTrainingAccess(request(sessionId), open, T0 + 1)).code).toBe('training_session_required');
  });
});

describe('startTrainingSession', () => {
  it('accepts the code regardless of case, spaces and hyphens', () => {
    const lower = SYNTHETIC.ACCESS_CODE.toLowerCase().replace(/-/g, ' ');
    expect(startTrainingSession(request(), lower, config('open'), T0).sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it.each([
    ['off', 409, 'training_off'],
    ['closed', 403, 'training_closed'],
  ] as const)('refuses code entry when mode is %s', (mode, status, code) => {
    const err = apiError(() => startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, config(mode), T0));
    expect([err.status, err.code]).toEqual([status, code]);
  });

  it('rejects malformed code input without counting it', () => {
    for (const code of [undefined, 42, '', 'x'.repeat(257)]) {
      expect(apiError(() => startTrainingSession(request(), code, config('open'), T0)).code).toBe('invalid_access_code_format');
    }
    expect(startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, config('open'), T0).sessionId).toBeTruthy();
  });

  it('throttles a client after repeated wrong codes, then recovers after the window', () => {
    const open = config('open');
    for (let i = 0; i < ATTEMPT_LIMITS.CLIENT_FAILURES; i++) {
      expect(apiError(() => startTrainingSession(request(), 'WRONGCODE1', open, T0 + i)).code).toBe('invalid_access_code');
    }
    const throttled = apiError(() => startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0 + 10));
    expect([throttled.status, throttled.code]).toEqual([429, 'too_many_attempts']);
    expect(throttled.retryAfterSeconds).toBe(600);

    // Another client is unaffected; the throttled client recovers after the window.
    expect(startTrainingSession(request(undefined, '198.51.100.2'), SYNTHETIC.ACCESS_CODE, open, T0 + 10).sessionId).toBeTruthy();
    expect(
      startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0 + ATTEMPT_LIMITS.CLIENT_WINDOW_MS + 1).sessionId
    ).toBeTruthy();
  });

  it('bounds wrong codes across all clients', () => {
    const open = config('open');
    for (let i = 0; i < ATTEMPT_LIMITS.HOST_FAILURES; i++) {
      apiError(() => startTrainingSession(request(undefined, `client-${i}`), 'WRONGCODE1', open, T0));
    }
    const err = apiError(() => startTrainingSession(request(undefined, 'fresh-client'), SYNTHETIC.ACCESS_CODE, open, T0 + 1));
    expect([err.status, err.code]).toEqual([429, 'too_many_attempts']);
    expect(startTrainingSession(request(undefined, 'fresh-client'), SYNTHETIC.ACCESS_CODE, open, T0 + ATTEMPT_LIMITS.HOST_WINDOW_MS).sessionId).toBeTruthy();
  });

  it('never logs the entered or configured code', () => {
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    apiError(() => startTrainingSession(request(), 'WRONGCODE1', config('open'), T0));
    startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, config('open'), T0);
    const output = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(output).not.toContain('WRONGCODE1');
    expect(output).not.toContain(SYNTHETIC.ACCESS_CODE);
  });
});

describe('describeTrainingAccess', () => {
  it('reports the state a browser needs', () => {
    expect(describeTrainingAccess(request(), config('off', null))).toEqual({ mode: 'off', active: true, expiresAt: null });
    expect(describeTrainingAccess(request(), config('closed'))).toMatchObject({ mode: 'closed', active: false });
    expect(describeTrainingAccess(request(), config('open', null))).toMatchObject({ mode: 'unavailable', active: false });
    expect(describeTrainingAccess(request(), config('open'), T0)).toMatchObject({ mode: 'open', active: false });

    const { sessionId, expiresAt } = startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, config('open'), T0);
    expect(describeTrainingAccess(request(sessionId), config('open'), T0 + 1)).toEqual({ mode: 'open', active: true, expiresAt });
  });
});
