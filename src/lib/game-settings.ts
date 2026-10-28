import { DEFAULTS } from '@/utils/constants';

export const MAX_PLAYER_NAME_LENGTH = 30;
const DEFAULT_PLAYER_NAME = 'Anonymous';

export interface GameSettings {
  playerName: string;
  totalRounds: number;
}

/**
 * Reads the alias and round count from URL parameters. Values the home form
 * could not produce (overlong or control-character names, non-integer or
 * out-of-range rounds) fall back to defaults instead of starting an invalid session.
 */
export function parseGameSettings(params: { get(name: string): string | null }): GameSettings {
  const name = (params.get('player') ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_PLAYER_NAME_LENGTH)
    .trim();

  const rawRounds = params.get('rounds');
  const rounds = rawRounds !== null && /^\d{1,2}$/.test(rawRounds) ? Number(rawRounds) : NaN;
  const totalRounds =
    rounds >= DEFAULTS.MIN_ROUNDS && rounds <= DEFAULTS.MAX_ROUNDS ? rounds : DEFAULTS.ROUND_COUNT;

  return { playerName: name || DEFAULT_PLAYER_NAME, totalRounds };
}
