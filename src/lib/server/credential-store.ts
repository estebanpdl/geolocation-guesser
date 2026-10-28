/**
 * Server-side credential store: a JSON file under the server account's
 * per-user configuration directory, outside the repository and served assets.
 *
 * This module uses only Node built-ins and relative imports so the operator
 * `auth` command can load it directly with Node's type stripping.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STORE_PATH_ENV = 'GEOLOCATION_GUESSER_CREDENTIALS_FILE';
const APP_DIRECTORY = 'geolocation-guesser';
const STORE_FILE = 'credentials.json';
const STORE_VERSION = 1;
const MAX_VALUE_LENGTH = 512;
const MAX_STORE_BYTES = 64 * 1024;

export const CREDENTIAL_FIELDS = ['geminiApiKey', 'openaiApiKey', 'mapsServerKey'] as const;
export type CredentialField = (typeof CREDENTIAL_FIELDS)[number];

export const TRAINING_MODES = ['off', 'open', 'closed'] as const;
export type TrainingMode = (typeof TRAINING_MODES)[number];

export interface StoreData {
  version: 1;
  credentials: Partial<Record<CredentialField, string>>;
  training: { mode?: TrainingMode; accessCode?: string };
}

export type StoreReadResult =
  | { status: 'missing'; path: string; data: StoreData }
  | { status: 'ok'; path: string; data: StoreData }
  | { status: 'invalid'; path: string; data: StoreData };

export class CredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

export function emptyStore(): StoreData {
  return { version: STORE_VERSION, credentials: {}, training: {} };
}

type Env = Record<string, string | undefined>;

/**
 * Resolves the store location for the current server account:
 * - an absolute path in GEOLOCATION_GUESSER_CREDENTIALS_FILE, if set;
 * - Windows: %LOCALAPPDATA%\geolocation-guesser\credentials.json;
 * - elsewhere: $XDG_CONFIG_HOME/geolocation-guesser/credentials.json,
 *   falling back to ~/.config/geolocation-guesser/credentials.json.
 */
export function resolveStorePath(env: Env = process.env, platform: NodeJS.Platform = process.platform): string {
  const override = env[STORE_PATH_ENV]?.trim();
  if (override) {
    if (!isAbsoluteFor(platform, override)) {
      throw new CredentialStoreError(`${STORE_PATH_ENV} must be an absolute path.`);
    }
    return override;
  }

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim();
    const base = localAppData && path.win32.isAbsolute(localAppData)
      ? localAppData
      : path.win32.join(homeDirectory(env, platform), 'AppData', 'Local');
    return path.win32.join(base, APP_DIRECTORY, STORE_FILE);
  }

  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(homeDirectory(env, platform), '.config');
  return path.posix.join(base, APP_DIRECTORY, STORE_FILE);
}

function isAbsoluteFor(platform: NodeJS.Platform, value: string): boolean {
  return platform === 'win32' ? path.win32.isAbsolute(value) : path.posix.isAbsolute(value);
}

function homeDirectory(env: Env, platform: NodeJS.Platform): string {
  const fromEnv = platform === 'win32' ? env.USERPROFILE : env.HOME;
  return fromEnv?.trim() || os.homedir();
}

/** Reads the store. A missing file is normal; an unreadable or malformed file is reported as invalid. */
export async function readStore(storePath: string): Promise<StoreReadResult> {
  let raw: string;
  try {
    const stat = await fs.stat(storePath);
    if (!stat.isFile() || stat.size > MAX_STORE_BYTES) {
      return { status: 'invalid', path: storePath, data: emptyStore() };
    }
    raw = await fs.readFile(storePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing', path: storePath, data: emptyStore() };
    }
    return { status: 'invalid', path: storePath, data: emptyStore() };
  }

  try {
    return { status: 'ok', path: storePath, data: parseStoreData(JSON.parse(raw)) };
  } catch {
    return { status: 'invalid', path: storePath, data: emptyStore() };
  }
}

export function parseStoreData(value: unknown): StoreData {
  if (!isPlainObject(value) || value.version !== STORE_VERSION) {
    throw new CredentialStoreError('Unsupported credential store format.');
  }
  const credentials = value.credentials ?? {};
  const training = value.training ?? {};
  if (!isPlainObject(credentials) || !isPlainObject(training)) {
    throw new CredentialStoreError('Unsupported credential store format.');
  }

  const data = emptyStore();
  for (const [key, entry] of Object.entries(credentials)) {
    if (!(CREDENTIAL_FIELDS as readonly string[]).includes(key) || !isStorableValue(entry)) {
      throw new CredentialStoreError('Unsupported credential store format.');
    }
    data.credentials[key as CredentialField] = entry;
  }
  if (training.mode !== undefined) {
    if (!isTrainingMode(training.mode)) throw new CredentialStoreError('Unsupported credential store format.');
    data.training.mode = training.mode;
  }
  if (training.accessCode !== undefined) {
    if (!isStorableValue(training.accessCode)) throw new CredentialStoreError('Unsupported credential store format.');
    data.training.accessCode = training.accessCode;
  }
  return data;
}

export function isTrainingMode(value: unknown): value is TrainingMode {
  return typeof value === 'string' && (TRAINING_MODES as readonly string[]).includes(value);
}

/** Values are single-line printable strings with a bounded length. */
export function isStorableValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_VALUE_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Atomically replaces the store: the new content is written to a sibling
 * temporary file created owner-only (0600; directory 0700), flushed, then
 * renamed over the old file. On Windows the file inherits the per-user
 * profile ACLs of its directory instead of POSIX modes.
 */
export async function writeStore(storePath: string, data: StoreData): Promise<void> {
  const normalized = parseStoreData(data);
  const directory = path.dirname(storePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });

  const tempPath = path.join(directory, `.${path.basename(storePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await fs.open(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(tempPath, storePath);
  } catch (err) {
    await fs.rm(tempPath, { force: true });
    throw err;
  }
  if (process.platform !== 'win32') {
    await fs.chmod(storePath, 0o600);
  }
}

/** Reports whether group/other permission bits are set on POSIX; null where not applicable. */
export async function hasBroadPermissions(storePath: string): Promise<boolean | null> {
  if (process.platform === 'win32') return null;
  try {
    const stat = await fs.stat(storePath);
    return (stat.mode & 0o077) !== 0;
  } catch {
    return null;
  }
}
