import { NextRequest } from 'next/server';
import { runPhotoAnalysis } from '@/lib/server/analysis';
import { errorResponse, jsonResponse, newRequestId } from '@/lib/server/api-error';
import { BODY_LIMITS } from '@/lib/server/limits';
import { readJsonObject } from '@/lib/server/request-body';
import { loadServerConfig } from '@/lib/server/server-config';
import { checkTrainingAccess } from '@/lib/server/training-access';
import { parsePhotoRequest } from '@/lib/server/validation';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  try {
    // Access is checked before the (up to 14 MiB) body is read.
    const config = await loadServerConfig();
    checkTrainingAccess(request, config);
    const image = parsePhotoRequest(await readJsonObject(request, BODY_LIMITS.PHOTO_ANALYSIS));
    const analysis = await runPhotoAnalysis(image, config, request.signal);
    return jsonResponse({ analysis }, requestId);
  } catch (err) {
    return errorResponse(err, requestId, 'ai-analysis-upload');
  }
}
