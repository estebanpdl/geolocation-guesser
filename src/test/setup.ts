/**
 * Test isolation applied to every test file:
 * - external network access is denied (fetch, and any socket connection);
 * - inherited credentials and training settings are removed, and credential
 *   store discovery points into test scratch instead of a real user profile;
 * - the Google Maps loader is replaced so no script is ever injected.
 * Tests that need a network boundary install a fake with `vi.stubGlobal('fetch', ...)`.
 */
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, vi } from 'vitest';

const TEST_SCRATCH = path.join(os.tmpdir(), `geolocation-guesser-tests-${process.pid}`);

const INHERITED_SETTINGS = [
  'GOOGLE_GENERATIVE_AI_KEY',
  'GOOGLE_MAPS_API_KEY',
  'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
  'OPENAI_API_KEY',
  'TRAINING_MODE',
  'TRAINING_ACCESS_CODE',
  'TRAINING_SESSION_TTL_MINUTES',
  'GEOLOCATION_GUESSER_CREDENTIALS_FILE',
];

function isolateEnvironment() {
  for (const name of INHERITED_SETTINGS) delete process.env[name];
  process.env.HOME = path.join(TEST_SCRATCH, 'home');
  process.env.USERPROFILE = process.env.HOME;
}

class BlockedNetworkError extends Error {
  constructor(target: string) {
    super(`External network access is blocked in tests (${target})`);
    this.name = 'BlockedNetworkError';
  }
}

function describeTarget(input: unknown): string {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.origin;
  } catch {
    return 'unknown target';
  }
}

const blockedFetch: typeof fetch = async (input) => {
  throw new BlockedNetworkError(`fetch ${describeTarget(input)}`);
};

globalThis.fetch = blockedFetch;
net.Socket.prototype.connect = function blockedConnect() {
  throw new BlockedNetworkError('socket connect');
} as typeof net.Socket.prototype.connect;

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: vi.fn(),
  importLibrary: vi.fn(() => Promise.reject(new Error('Google Maps is not available in tests'))),
}));

isolateEnvironment();
beforeEach(isolateEnvironment);
