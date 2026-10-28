import { NextRequest } from 'next/server';
import { haversineDistance, getAccuracyCategory, calculateScore } from '@/lib/distance';
import { errorResponse, jsonResponse, newRequestId } from '@/lib/server/api-error';
import { BODY_LIMITS } from '@/lib/server/limits';
import { readJsonObject } from '@/lib/server/request-body';
import { parseScoreRequest } from '@/lib/server/validation';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  try {
    const { guess, actual } = parseScoreRequest(await readJsonObject(request, BODY_LIMITS.SCORE));

    const distanceKm = haversineDistance(guess, actual);
    const score = calculateScore(distanceKm);
    const category = getAccuracyCategory(distanceKm);

    return jsonResponse(
      {
        distanceKm: parseFloat(distanceKm.toFixed(2)),
        score,
        category,
      },
      requestId
    );
  } catch (err) {
    return errorResponse(err, requestId, 'score');
  }
}
