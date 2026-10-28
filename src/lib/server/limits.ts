/** Request, image, time and output bounds shared by the API routes. */

const KIB = 1024;
const MIB = 1024 * KIB;

export const BODY_LIMITS = {
  SCORE: 4 * KIB,
  GENERATE_LOCATION: 16 * KIB,
  SCENE_ANALYSIS: 4 * KIB,
  TRAINING_SESSION: 1 * KIB,
  // A 10 MiB photo is 13,981,016 base64 characters; the rest covers the JSON envelope.
  PHOTO_ANALYSIS: 14 * MIB,
} as const;

export const MAX_USED_LOCATIONS = 100;

export const PHOTO_LIMITS = {
  MAX_BYTES: 10 * MIB,
  MIN_SIDE_PX: 16,
  MAX_SIDE_PX: 12_000,
  MAX_PIXELS: 50_000_000,
} as const;

export const STREET_VIEW_LIMITS = {
  MAX_BYTES: 4 * MIB,
  MAX_REDIRECTS: 2,
  FETCH_TIMEOUT_MS: 10_000,
} as const;

export const ANALYSIS_LIMITS = {
  /** End-to-end budget for image acquisition plus inference. */
  DEADLINE_MS: 60_000,
  /** Includes any model reasoning tokens, so it is set well above the visible answer length. */
  MAX_OUTPUT_TOKENS: 8192,
  MAX_OUTPUT_CHARS: 50_000,
} as const;
