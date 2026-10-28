import { NextRequest } from 'next/server';
import { errorResponse, jsonResponse, newRequestId } from '@/lib/server/api-error';
import { BODY_LIMITS } from '@/lib/server/limits';
import { readJsonObject } from '@/lib/server/request-body';
import { loadServerConfig } from '@/lib/server/server-config';
import {
  clearSessionCookie,
  describeTrainingAccess,
  endTrainingSession,
  setSessionCookie,
  startTrainingSession,
} from '@/lib/server/training-access';

/** Whether training access is required and whether this browser holds a live session. */
export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  try {
    const config = await loadServerConfig();
    return jsonResponse({ training: describeTrainingAccess(request, config) }, requestId);
  } catch (err) {
    return errorResponse(err, requestId, 'training-session');
  }
}

/** Exchanges the training access code for a session cookie. */
export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  try {
    const config = await loadServerConfig();
    const body = await readJsonObject(request, BODY_LIMITS.TRAINING_SESSION);
    const now = Date.now();
    const { sessionId, expiresAt } = startTrainingSession(request, body.code, config, now);
    const response = jsonResponse({ training: { mode: 'open', active: true, expiresAt } }, requestId);
    setSessionCookie(response, request, sessionId, expiresAt, now);
    return response;
  } catch (err) {
    return errorResponse(err, requestId, 'training-session');
  }
}

/** Ends this browser's session. */
export async function DELETE(request: NextRequest) {
  const requestId = newRequestId();
  endTrainingSession(request);
  const response = jsonResponse({ training: { active: false } }, requestId);
  clearSessionCookie(response, request);
  return response;
}
