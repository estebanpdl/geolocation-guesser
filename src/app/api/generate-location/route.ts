import { NextRequest } from 'next/server';
import { LOCATION_POOL } from '@/lib/location-pool';
import { ApiError, errorResponse, jsonResponse, newRequestId } from '@/lib/server/api-error';
import { BODY_LIMITS } from '@/lib/server/limits';
import { readJsonObject } from '@/lib/server/request-body';
import { parseUsedLocations } from '@/lib/server/validation';
import type { Coordinate } from '@/lib/types';

const MIN_DISTANCE_KM = 50;

function distanceKm(a: Coordinate, b: Coordinate): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function isTooClose(coord: Coordinate, used: Coordinate[]): boolean {
  const latBuffer = MIN_DISTANCE_KM / 111; // ~km per lat degree

  return used.some((u) => {
    // Quick latitude reject
    if (Math.abs(coord.lat - u.lat) > latBuffer) return false;

    // Quick longitude reject (adjusted by latitude)
    const lngBuffer =
      MIN_DISTANCE_KM / (111 * Math.cos((u.lat * Math.PI) / 180));

    if (Math.abs(coord.lng - u.lng) > lngBuffer) return false;

    // Only now do expensive Haversine
    return distanceKm(coord, u) < MIN_DISTANCE_KM;
  });
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  try {
    const usedLocations = parseUsedLocations(
      await readJsonObject(request, BODY_LIMITS.GENERATE_LOCATION)
    );

    const validLocations = LOCATION_POOL.filter(
      (coord) => !isTooClose(coord, usedLocations)
    );

    if (validLocations.length === 0) {
      throw new ApiError(400, 'no_locations_available', 'No valid locations available');
    }

    const pick =
      validLocations[Math.floor(Math.random() * validLocations.length)];

    return jsonResponse({ coordinate: pick, source: 'pool' }, requestId);
  } catch (err) {
    return errorResponse(err, requestId, 'generate-location');
  }
}
