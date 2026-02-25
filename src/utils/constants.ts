export const SCORING = {
  MAX_SCORE: 5000,
  DECAY_FACTOR: 2000, // km — controls how fast score drops with distance
  EXCELLENT_THRESHOLD_KM: 50,
  GOOD_THRESHOLD_KM: 300,
  FAIR_THRESHOLD_KM: 1500,
} as const;

export const DEFAULTS = {
  ROUND_COUNT: 5,
  MIN_ROUNDS: 1,
  MAX_ROUNDS: 10,
  CONFIDENCE_MIN: 1,
  CONFIDENCE_MAX: 5,
} as const;

export const MAP_DEFAULTS = {
  CENTER: { lat: 20, lng: 0 },
  ZOOM: 2,
  GUESS_ZOOM: 4,
} as const;
