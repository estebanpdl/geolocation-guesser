import { describe, expect, it } from 'vitest';
import { parseGameSettings } from '../game-settings';

const settings = (query: string) => parseGameSettings(new URLSearchParams(query));

describe('parseGameSettings', () => {
  it('accepts values the home form produces', () => {
    expect(settings('player=Scout&rounds=7')).toEqual({ playerName: 'Scout', totalRounds: 7 });
  });

  it.each(['rounds=0', 'rounds=11', 'rounds=-3', 'rounds=2.5', 'rounds=abc', 'rounds=', 'rounds=1e1', ''])(
    'uses the default round count for "%s"',
    (query) => {
      expect(settings(query).totalRounds).toBe(5);
    }
  );

  it('trims, strips control characters and bounds the alias', () => {
    expect(settings(`player=${encodeURIComponent('  a\u0000b\nc  ')}`).playerName).toBe('abc');
    expect(settings(`player=${'x'.repeat(80)}`).playerName).toHaveLength(30);
  });

  it('falls back to Anonymous for an empty alias', () => {
    expect(settings('player=%20%20').playerName).toBe('Anonymous');
  });
});
