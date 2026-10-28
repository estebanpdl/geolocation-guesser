// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { haversineDistance, getAccuracyCategory, calculateScore } from '@/lib/distance';
import { jsonRequest } from '@/test/fakes';
import { POST } from '../score/route';

// Test the scoring logic that the API route uses
describe('Score API logic', () => {
  it('calculates correct score for Paris to London guess', () => {
    const guess = { lat: 51.5074, lng: -0.1278 }; // London
    const actual = { lat: 48.8566, lng: 2.3522 }; // Paris

    const distanceKm = haversineDistance(guess, actual);
    const score = calculateScore(distanceKm);
    const category = getAccuracyCategory(distanceKm);

    expect(distanceKm).toBeGreaterThan(330);
    expect(distanceKm).toBeLessThan(360);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(5000);
    expect(category).toBe('Fair'); // ~343 km is between Good (300) and Fair (1500) thresholds
  });

  it('gives max score for exact match', () => {
    const point = { lat: 48.8566, lng: 2.3522 };

    const distanceKm = haversineDistance(point, point);
    const score = calculateScore(distanceKm);
    const category = getAccuracyCategory(distanceKm);

    expect(distanceKm).toBe(0);
    expect(score).toBe(5000);
    expect(category).toBe('Excellent');
  });

  it('gives near-zero score for antipodal points', () => {
    const guess = { lat: 0, lng: 0 };
    const actual = { lat: 0, lng: 180 };

    const distanceKm = haversineDistance(guess, actual);
    const score = calculateScore(distanceKm);
    const category = getAccuracyCategory(distanceKm);

    expect(distanceKm).toBeGreaterThan(19900);
    expect(score).toBeLessThan(10);
    expect(category).toBe('Poor');
  });
});

describe('POST /api/score', () => {
  const PARIS = { lat: 48.8566, lng: 2.3522 };
  const LONDON = { lat: 51.5074, lng: -0.1278 };

  it('scores a guess with the shared scoring rules', async () => {
    const response = await POST(jsonRequest('/api/score', { guess: LONDON, actual: PARIS }));
    const body = await response.json();
    const distanceKm = haversineDistance(LONDON, PARIS);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      distanceKm: parseFloat(distanceKm.toFixed(2)),
      score: calculateScore(distanceKm),
      category: 'Fair',
    });
  });

  it.each([
    [{ guess: LONDON }],
    [{ guess: { lat: 51.5 }, actual: PARIS }],
    [{ guess: LONDON, actual: { lat: 48.8, lng: 'east' } }],
    [{ guess: LONDON, actual: { lat: 48.8, lng: 200 } }],
    [{ guess: { lat: -91, lng: 0 }, actual: PARIS }],
  ])('rejects invalid coordinates %j', async (body) => {
    const response = await POST(jsonRequest('/api/score', body));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_coordinates');
  });

  it('rejects malformed JSON as a client error', async () => {
    const response = await POST(jsonRequest('/api/score', '{"guess":'));
    expect(response.status).toBe(400);
  });
});
