// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { POST } from '../generate-location/route';
import { LOCATION_POOL } from '@/lib/location-pool';
import { jsonRequest } from '@/test/fakes';

function generate(body: unknown) {
  return POST(jsonRequest('/api/generate-location', body));
}

describe('POST /api/generate-location', () => {
  it('returns a pool coordinate', async () => {
    const response = await generate({});
    const { coordinate, source } = await response.json();
    expect(response.status).toBe(200);
    expect(source).toBe('pool');
    expect(LOCATION_POOL).toContainEqual(coordinate);
  });

  it('avoids coordinates near used locations', async () => {
    const used = LOCATION_POOL[0];
    for (let i = 0; i < 5; i++) {
      const { coordinate } = await (await generate({ usedLocations: [used] })).json();
      expect(coordinate).not.toEqual(used);
    }
  });

  it.each([
    [{ usedLocations: 'paris' }, 'invalid_used_locations'],
    [{ usedLocations: Array(101).fill({ lat: 0, lng: 0 }) }, 'invalid_used_locations'],
    [{ usedLocations: [{ lat: 0 }] }, 'invalid_coordinates'],
    [{ usedLocations: [null] }, 'invalid_coordinates'],
    ['null', 'invalid_body'],
  ])('rejects %j with 400', async (body, code) => {
    const response = await generate(body);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe(code);
  });

  it('rejects an oversized body', async () => {
    const response = await generate({ usedLocations: [], padding: 'x'.repeat(20_000) });
    expect(response.status).toBe(413);
  });
});
