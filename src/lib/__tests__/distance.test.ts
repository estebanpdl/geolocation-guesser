import { describe, it, expect } from 'vitest';
import { haversineDistance, getAccuracyCategory, calculateScore } from '../distance';

describe('haversineDistance', () => {
  it('returns 0 for the same point', () => {
    const point = { lat: 48.8566, lng: 2.3522 };
    expect(haversineDistance(point, point)).toBe(0);
  });

  it('calculates known distance: Paris to London (~343 km)', () => {
    const paris = { lat: 48.8566, lng: 2.3522 };
    const london = { lat: 51.5074, lng: -0.1278 };
    const distance = haversineDistance(paris, london);
    expect(distance).toBeGreaterThan(330);
    expect(distance).toBeLessThan(360);
  });

  it('calculates known distance: New York to Los Angeles (~3944 km)', () => {
    const nyc = { lat: 40.7128, lng: -74.006 };
    const la = { lat: 34.0522, lng: -118.2437 };
    const distance = haversineDistance(nyc, la);
    expect(distance).toBeGreaterThan(3900);
    expect(distance).toBeLessThan(4000);
  });

  it('handles points near the poles', () => {
    const northPole = { lat: 89, lng: 0 };
    const southPole = { lat: -89, lng: 0 };
    const distance = haversineDistance(northPole, southPole);
    // Should be close to half Earth circumference (~19,800 km)
    expect(distance).toBeGreaterThan(19500);
    expect(distance).toBeLessThan(20100);
  });

  it('handles antipodal points', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0, lng: 180 };
    const distance = haversineDistance(a, b);
    // Should be half Earth circumference (~20,015 km)
    expect(distance).toBeGreaterThan(19900);
    expect(distance).toBeLessThan(20100);
  });

  it('handles date line crossing', () => {
    const a = { lat: 0, lng: 179 };
    const b = { lat: 0, lng: -179 };
    const distance = haversineDistance(a, b);
    // These points are 2 degrees apart at the equator (~222 km)
    expect(distance).toBeGreaterThan(200);
    expect(distance).toBeLessThan(250);
  });

  it('is symmetric', () => {
    const a = { lat: 35.6762, lng: 139.6503 };
    const b = { lat: -33.8688, lng: 151.2093 };
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 10);
  });
});

describe('getAccuracyCategory', () => {
  it('returns Excellent for distances under 50 km', () => {
    expect(getAccuracyCategory(0)).toBe('Excellent');
    expect(getAccuracyCategory(25)).toBe('Excellent');
    expect(getAccuracyCategory(50)).toBe('Excellent');
  });

  it('returns Good for distances 51-300 km', () => {
    expect(getAccuracyCategory(51)).toBe('Good');
    expect(getAccuracyCategory(200)).toBe('Good');
    expect(getAccuracyCategory(300)).toBe('Good');
  });

  it('returns Fair for distances 301-1500 km', () => {
    expect(getAccuracyCategory(301)).toBe('Fair');
    expect(getAccuracyCategory(1000)).toBe('Fair');
    expect(getAccuracyCategory(1500)).toBe('Fair');
  });

  it('returns Poor for distances over 1500 km', () => {
    expect(getAccuracyCategory(1501)).toBe('Poor');
    expect(getAccuracyCategory(10000)).toBe('Poor');
  });
});

describe('calculateScore', () => {
  it('returns max score for very close guesses', () => {
    expect(calculateScore(0)).toBe(5000);
    expect(calculateScore(0.01)).toBe(5000);
  });

  it('returns higher scores for closer guesses', () => {
    const close = calculateScore(10);
    const medium = calculateScore(500);
    const far = calculateScore(5000);
    expect(close).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(far);
  });

  it('returns 0 or near 0 for very far guesses', () => {
    const score = calculateScore(20000);
    expect(score).toBeLessThan(50);
  });

  it('never returns negative', () => {
    expect(calculateScore(100000)).toBeGreaterThanOrEqual(0);
  });
});
