import { NextRequest, NextResponse } from 'next/server';
import { haversineDistance, getAccuracyCategory, calculateScore } from '@/lib/distance';
import type { Coordinate } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { guess, actual }: { guess: Coordinate; actual: Coordinate } = body;

    if (!guess || !actual || typeof guess.lat !== 'number' || typeof actual.lat !== 'number') {
      return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
    }

    const distanceKm = haversineDistance(guess, actual);
    const score = calculateScore(distanceKm);
    const category = getAccuracyCategory(distanceKm);

    return NextResponse.json({
      distanceKm: parseFloat(distanceKm.toFixed(2)),
      score,
      category,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to calculate score' }, { status: 500 });
  }
}
