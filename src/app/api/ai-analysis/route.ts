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
    // Access, input, model selection and credentials are all checked before any external request.
    const config = await loadServerConfig();
    checkTrainingAccess(request, config);
    const body = await readJsonObject(request, BODY_LIMITS.SCENE_ANALYSIS);
    const view = parseStreetViewRequest(body);
    const outcome = await runSceneAnalysis(
      view,
      { selection: body.selection, participantKey: body.participantKey },
      config,
      request.signal
    );
    return jsonResponse({ ...outcome }, requestId);
  } catch (err) {
    return errorResponse(err, requestId, 'ai-analysis');
  }
}
