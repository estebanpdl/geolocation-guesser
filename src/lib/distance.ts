import type { Coordinate, AccuracyCategory } from './types';
import { SCORING } from '@/utils/constants';

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistance(a: Coordinate, b: Coordinate): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinDLng * sinDLng;

  const c = 2 * Math.asin(Math.sqrt(h));

  return EARTH_RADIUS_KM * c;
}

export function getAccuracyCategory(distanceKm: number): AccuracyCategory {
  if (distanceKm <= SCORING.EXCELLENT_THRESHOLD_KM) return 'Excellent';
  if (distanceKm <= SCORING.GOOD_THRESHOLD_KM) return 'Good';
  if (distanceKm <= SCORING.FAIR_THRESHOLD_KM) return 'Fair';
  return 'Poor';
}

export function calculateScore(distanceKm: number): number {
  if (distanceKm <= 0.05) return SCORING.MAX_SCORE;
  // Exponential decay: closer = higher score
  const score = Math.round(
    SCORING.MAX_SCORE * Math.exp(-distanceKm / SCORING.DECAY_FACTOR)
  );
  return Math.max(0, score);
}
