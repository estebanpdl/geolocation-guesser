/**
 * Effective server configuration: operator credentials and training access settings.
 *
 * Precedence per field: a nonempty, non-placeholder environment variable, then the
 * credential store, then unavailable. The one exception is the training mode: a saved
 * `closed` overrides the environment. Values are never included in status output.
 * Like credential-store.ts, this module is loadable by the `auth` command directly.
 */
import { randomInt } from 'node:crypto';
import { promises as fs } from 'node:fs';
import {
  CREDENTIAL_FIELDS,
  isTrainingMode,
  readStore,
  resolveStorePath,
  emptyStore,
  STORE_PATH_ENV,
  type CredentialField,
  type StoreData,
  type TrainingMode,
} from './credential-store.ts';

type Env = Record<string, string | undefined>;

export const CREDENTIAL_ENV: Record<CredentialField, string> = {
  geminiApiKey: 'GOOGLE_GENERATIVE_AI_KEY',
  openaiApiKey: 'OPENAI_API_KEY',
  mapsServerKey: 'GOOGLE_MAPS_API_KEY',
};

/** Older setups configured only the browser Maps key; it remains the last resort for Street View images. */
export const PUBLIC_MAPS_KEY_ENV = 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY';

export const TRAINING_ENV = {
  MODE: 'TRAINING_MODE',
  ACCESS_CODE: 'TRAINING_ACCESS_CODE',
  SESSION_TTL_MINUTES: 'TRAINING_SESSION_TTL_MINUTES',
} as const;

export const ACCESS_CODE_MIN_LENGTH = 8;
export const ACCESS_CODE_MAX_LENGTH = 128;
export const SESSION_TTL_DEFAULT_MINUTES = 180;
const SESSION_TTL_MIN_MINUTES = 5;
const SESSION_TTL_MAX_MINUTES = 24 * 60;

export type ValueSource = 'environment' | 'store' | 'public-environment';

export interface ResolvedValue {
  value: string;
  source: ValueSource;
}

export type StoreStatus = 'missing' | 'ok' | 'invalid' | 'path_error';

export interface ServerConfig {
  storePath: string | null;
  storeStatus: StoreStatus;
  credentials: Partial<Record<CredentialField, ResolvedValue>>;
  training: {
    mode: TrainingMode;
    modeSource: 'environment' | 'store' | 'default' | 'fail-closed';
    /** Normalized access code; null when unset or unusable. */
    accessCode: ResolvedValue | null;
    sessionTtlMinutes: number;
  };
  /** Safe problem codes for status output; never contain values. */
  problems: string[];
}

/** Blank values and template placeholders such as `your_api_key_here` count as absent. */
export function effectiveValue(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^your[_-][\w-]*[_-]here$/i.test(value)) return null;
  return value;
}

/** Access codes ignore case, spaces and hyphens, so `abcd-efgh` matches `ABCDEFGH`. */
export function normalizeAccessCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '');
}

export function isUsableAccessCode(normalized: string): boolean {
  return normalized.length >= ACCESS_CODE_MIN_LENGTH && normalized.length <= ACCESS_CODE_MAX_LENGTH;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Generates a 16-character code (about 79 bits) from an alphabet without look-alike characters. */
export function generateAccessCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) group += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    groups.push(group);
  }
  return groups.join('-');
}

export function resolveServerConfig(env: Env, store: { status: StoreStatus; path: string | null; data: StoreData }): ServerConfig {
  const problems: string[] = [];
  const storeUsable = store.status === 'ok' || store.status === 'missing';
  if (store.status === 'invalid') problems.push('credential_store_invalid');
  if (store.status === 'path_error') problems.push('credential_store_path_invalid');

  const credentials: Partial<Record<CredentialField, ResolvedValue>> = {};
  for (const field of CREDENTIAL_FIELDS) {
    const fromEnv = effectiveValue(env[CREDENTIAL_ENV[field]]);
    const fromStore = storeUsable ? effectiveValue(store.data.credentials[field]) : null;
    if (fromEnv) credentials[field] = { value: fromEnv, source: 'environment' };
    else if (fromStore) credentials[field] = { value: fromStore, source: 'store' };
  }
  if (!credentials.mapsServerKey) {
    const publicKey = effectiveValue(env[PUBLIC_MAPS_KEY_ENV]);
    if (publicKey) credentials.mapsServerKey = { value: publicKey, source: 'public-environment' };
  }

  // Mode: an invalid explicit setting or an unreadable store blocks paid routes rather than opening them.
  // A saved `closed` is the operator's off switch, so it also wins over an environment mode.
  let mode: TrainingMode;
  let modeSource: ServerConfig['training']['modeSource'];
  const envMode = env[TRAINING_ENV.MODE]?.trim().toLowerCase();
  const storeMode = storeUsable ? store.data.training.mode : undefined;
  if (envMode && !isTrainingMode(envMode)) {
    mode = 'closed';
    modeSource = 'fail-closed';
    problems.push('training_mode_invalid');
  } else if (!storeUsable) {
    mode = 'closed';
    modeSource = 'fail-closed';
  } else if (storeMode === 'closed') {
    mode = 'closed';
    modeSource = 'store';
  } else if (envMode) {
    mode = envMode as TrainingMode;
    modeSource = 'environment';
  } else if (storeMode) {
    mode = storeMode;
    modeSource = 'store';
  } else {
    mode = 'off';
    modeSource = 'default';
  }

  let accessCode: ResolvedValue | null = null;
  const envCode = effectiveValue(env[TRAINING_ENV.ACCESS_CODE]);
  const storeCode = storeUsable ? effectiveValue(store.data.training.accessCode) : null;
  const rawCode = envCode
    ? { value: envCode, source: 'environment' as const }
    : storeCode
      ? { value: storeCode, source: 'store' as const }
      : null;
  if (rawCode) {
    const normalized = normalizeAccessCode(rawCode.value);
    if (isUsableAccessCode(normalized)) accessCode = { value: normalized, source: rawCode.source };
    else problems.push('training_access_code_invalid');
  }
  if (mode === 'open' && !accessCode) problems.push('training_access_code_missing');

  let sessionTtlMinutes = SESSION_TTL_DEFAULT_MINUTES;
  const rawTtl = env[TRAINING_ENV.SESSION_TTL_MINUTES]?.trim();
  if (rawTtl) {
    const parsed = /^\d+$/.test(rawTtl) ? Number(rawTtl) : NaN;
    if (parsed >= SESSION_TTL_MIN_MINUTES && parsed <= SESSION_TTL_MAX_MINUTES) sessionTtlMinutes = parsed;
    else problems.push('training_session_ttl_invalid');
  }

  return {
    storePath: store.path,
    storeStatus: store.status,
    credentials,
    training: { mode, modeSource, accessCode, sessionTtlMinutes },
    problems,
  };
}

interface StoreCacheEntry {
  key: string;
  result: { status: StoreStatus; path: string | null; data: StoreData };
}

const CACHE_KEY = Symbol.for('geolocation-guesser.credential-store-cache');
type CacheHolder = { [CACHE_KEY]?: StoreCacheEntry };

/**
 * Loads the effective configuration. The store file is re-read whenever its
 * modification time or size changes, so `auth` updates (including training code
 * rotation and closure) apply to a running server without a restart.
 */
export async function loadServerConfig(env: Env = process.env): Promise<ServerConfig> {
  let storePath: string;
  try {
    storePath = resolveStorePath(env);
  } catch {
    return resolveServerConfig(env, { status: 'path_error', path: null, data: emptyStore() });
  }

  let fingerprint = 'missing';
  try {
    const stat = await fs.stat(storePath);
    // The inode changes on every atomic replace, even within the timestamp resolution.
    fingerprint = `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    // Missing or unreadable; readStore classifies it.
  }

  const holder = globalThis as CacheHolder;
  const key = `${storePath}|${fingerprint}`;
  let cached = holder[CACHE_KEY];
  if (!cached || cached.key !== key) {
    const result = await readStore(storePath);
    cached = { key, result };
    holder[CACHE_KEY] = cached;
  }
  return resolveServerConfig(env, cached.result);
}

const SOURCE_LABELS: Record<ValueSource, string> = {
  environment: 'environment',
  store: 'credential store',
  'public-environment': `${PUBLIC_MAPS_KEY_ENV} fallback`,
};

const CREDENTIAL_LABELS: Record<CredentialField, string> = {
  geminiApiKey: 'Gemini API key',
  openaiApiKey: 'OpenAI API key',
  mapsServerKey: 'Street View server key',
};

const PROBLEM_TEXT: Record<string, string> = {
  credential_store_invalid: 'The credential store could not be read or has an unsupported format; training access is closed.',
  credential_store_path_invalid: `${STORE_PATH_ENV} must be an absolute path; training access is closed.`,
  training_mode_invalid: `${TRAINING_ENV.MODE} must be off, open or closed; training access is closed.`,
  training_access_code_invalid: `The training access code must have ${ACCESS_CODE_MIN_LENGTH}-${ACCESS_CODE_MAX_LENGTH} characters (ignoring spaces and hyphens).`,
  training_access_code_missing: 'Training is open but no usable access code is configured; analysis requests are refused.',
  training_session_ttl_invalid: `${TRAINING_ENV.SESSION_TTL_MINUTES} must be a whole number of minutes from ${SESSION_TTL_MIN_MINUTES} to ${SESSION_TTL_MAX_MINUTES}; the default is used.`,
};

/** Human-readable status lines that state only whether settings exist and where they come from. */
export function describeServerConfig(config: ServerConfig): string[] {
  const lines: string[] = [];
  const storeState = {
    ok: 'present',
    missing: 'not created yet',
    invalid: 'unreadable or unsupported format',
    path_error: 'invalid location',
  }[config.storeStatus];
  lines.push(`Credential store: ${config.storePath ?? '(unresolved)'} (${storeState})`);

  for (const field of CREDENTIAL_FIELDS) {
    const resolved = config.credentials[field];
    lines.push(`${CREDENTIAL_LABELS[field]}: ${resolved ? `configured (${SOURCE_LABELS[resolved.source]})` : 'not configured'}`);
  }

  const { training } = config;
  const modeOrigin = training.modeSource === 'fail-closed' ? 'blocked by a configuration problem' : training.modeSource;
  lines.push(`Training mode: ${training.mode} (${modeOrigin})`);
  lines.push(`Training access code: ${training.accessCode ? `configured (${SOURCE_LABELS[training.accessCode.source]})` : 'not configured'}`);
  lines.push(`Training session lifetime: ${training.sessionTtlMinutes} minutes`);

  for (const problem of config.problems) {
    lines.push(`Problem: ${PROBLEM_TEXT[problem] ?? problem}`);
  }
  return lines;
}
