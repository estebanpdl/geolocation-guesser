import { NextRequest, NextResponse } from 'next/server';
import { LOCATION_POOL } from '@/lib/location-pool';
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
  try {
    const body = await request.json();
    const { usedLocations = [] } = body as { usedLocations?: Coordinate[] };

    const validLocations = LOCATION_POOL.filter(
      (coord) => !isTooClose(coord, usedLocations)
    );

    if (validLocations.length === 0) {
      return NextResponse.json(
        { error: 'No valid locations available' },
        { status: 400 }
      );
    }

    const pick =
      validLocations[Math.floor(Math.random() * validLocations.length)];

    return NextResponse.json({ coordinate: pick, source: 'pool' });
  } catch {
    return NextResponse.json(
      { error: 'Failed to generate location' },
      { status: 500 }
    );
  }
}
