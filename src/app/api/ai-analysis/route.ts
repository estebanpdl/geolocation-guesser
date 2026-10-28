import { NextRequest } from 'next/server';
import { runSceneAnalysis } from '@/lib/server/analysis';
import { errorResponse, jsonResponse, newRequestId } from '@/lib/server/api-error';
import { BODY_LIMITS } from '@/lib/server/limits';
import { readJsonObject } from '@/lib/server/request-body';
import { loadServerConfig } from '@/lib/server/server-config';
import { checkTrainingAccess } from '@/lib/server/training-access';
import { parseStreetViewRequest } from '@/lib/server/validation';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  try {
    // Access, input and configuration are all checked before any external request.
    const config = await loadServerConfig();
    checkTrainingAccess(request, config);
    const view = parseStreetViewRequest(await readJsonObject(request, BODY_LIMITS.SCENE_ANALYSIS));
    const analysis = await runSceneAnalysis(view, config, request.signal);
    return jsonResponse({ analysis }, requestId);
  } catch (err) {
    return errorResponse(err, requestId, 'ai-analysis');
  }
}
