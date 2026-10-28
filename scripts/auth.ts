/**
 * Operator command for server-side credentials and training access.
 *
 *   npm run auth -- <command>
 *
 * Secrets are entered at a masked prompt and saved to the per-user credential
 * store. Status output reports only whether each setting is configured and
 * where it comes from, never the value. Settings are evaluated against the
 * environment the server sees: this shell plus the project's .env files.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  hasBroadPermissions,
  isStorableValue,
  readStore,
  resolveStorePath,
  STORE_PATH_ENV,
  writeStore,
  type CredentialField,
  type StoreData,
  type TrainingMode,
} from '../src/lib/server/credential-store.ts';
import {
  ACCESS_CODE_MAX_LENGTH,
  ACCESS_CODE_MIN_LENGTH,
  CREDENTIAL_ENV,
  TRAINING_ENV,
  describeServerConfig,
  effectiveValue,
  generateAccessCode,
  isUsableAccessCode,
  normalizeAccessCode,
  resolveServerConfig,
} from '../src/lib/server/server-config.ts';
import { commandFor, loadServerEnvs, SHELL_SOURCE, type ServerEnv } from './project-env.ts';

export interface AuthIO {
  /** This process's environment. */
  env: Record<string, string | undefined>;
  /** Project root containing the server's .env files. */
  projectDir: string;
  out(line: string): void;
  err(line: string): void;
  /** Reads one line without echoing it. */
  readSecret(prompt: string): Promise<string>;
}

const CREDENTIAL_NAMES: Record<string, { field: CredentialField; label: string }> = {
  gemini: { field: 'geminiApiKey', label: 'Gemini API key' },
  openai: { field: 'openaiApiKey', label: 'OpenAI API key' },
  'maps-server': { field: 'mapsServerKey', label: 'Street View server key' },
};

const USAGE = `Usage: npm run auth -- <command>

Commands:
  status                        Show which settings are configured (values are never shown)
  path                          Show the credential store location
  set <gemini|openai|maps-server>
                                Save a server credential (masked prompt)
  remove <gemini|openai|maps-server>
                                Delete a saved server credential
  training code                 Save a training access code (masked prompt)
  training rotate               Generate and save a new access code; it is shown once
  training open                 Require the access code for AI analysis
  training close                Block AI analysis for everyone
  training off                  Local use: AI analysis needs no access code

Saved settings live in ~/.geolocation-guesser/credentials.json, or in the absolute path set by
${STORE_PATH_ENV}.

Environment variables, from this shell or the project's .env files, override saved values:
${Object.values(CREDENTIAL_ENV).join(', ')}, ${TRAINING_ENV.MODE}, ${TRAINING_ENV.ACCESS_CODE}.
A saved "closed" training mode overrides ${TRAINING_ENV.MODE}. Training changes that an
environment value would override are refused. Changes apply to a running server on its next
request. Rotating the code ends existing training sessions.`;

export async function runAuth(args: string[], io: AuthIO): Promise<number> {
  const [command = 'status', subject, ...rest] = args;
  try {
    if (rest.length > 0) return usageError(io);
    switch (command) {
      case 'status':
        return subject ? usageError(io) : await status(io);
      case 'path':
        if (subject) return usageError(io);
        io.out(storeLocation(loadServerEnvs(io.projectDir, io.env)));
        return 0;
      case 'set':
        return await setCredential(io, subject);
      case 'remove':
        return await removeCredential(io, subject);
      case 'training':
        return await training(io, subject);
      case 'help':
      case '--help':
      case '-h':
        io.out(USAGE);
        return 0;
      default:
        return usageError(io);
    }
  } catch (err) {
    io.err(`Error: ${err instanceof Error ? err.message : 'unexpected failure'}`);
    return 1;
  }
}

function usageError(io: AuthIO): number {
  io.err(USAGE);
  return 2;
}

/** The store both `next start` and `next dev` would use; differing locations are an error. */
function storeLocation(envs: ServerEnv[]): string {
  const paths = envs.map((e) => resolveStorePath(e.env));
  if (new Set(paths).size > 1) {
    const detail = envs.map((e, i) => `${commandFor(e.mode)}: ${paths[i]}`).join('; ');
    throw new Error(`The server would use different credential stores (${detail}). Set GEOLOCATION_GUESSER_CREDENTIALS_FILE consistently.`);
  }
  return paths[0];
}

/** Where a variable is effectively set, e.g. ".env.local" or ".env.development (next dev)". */
function overrideSources(envs: ServerEnv[], name: string): string[] {
  const modesBySource = new Map<string, string[]>();
  for (const e of envs) {
    if (!effectiveValue(e.env[name])) continue;
    const source = e.sources[name];
    modesBySource.set(source, [...(modesBySource.get(source) ?? []), commandFor(e.mode)]);
  }
  return [...modesBySource].map(([source, modes]) =>
    modes.length === envs.length ? source : `${source} (${modes.join(', ')})`
  );
}

function describeEnvSources(e: ServerEnv): string {
  return [SHELL_SOURCE, ...e.loadedFiles].join(', ');
}

async function status(io: AuthIO): Promise<number> {
  const envs = loadServerEnvs(io.projectDir, io.env);
  const storePath = storeLocation(envs);
  const store = await readStore(storePath);
  const [production, development] = envs.map((e) => describeServerConfig(resolveServerConfig(e.env, store)));

  io.out(`Settings for next start (${describeEnvSources(envs[0])}):`);
  for (const line of production) io.out(line);
  const devOnly = development.filter((line) => !production.includes(line));
  if (devOnly.length > 0) {
    io.out(`Differences under next dev (${describeEnvSources(envs[1])}):`);
    for (const line of devOnly) io.out(line);
  }
  if (store.status === 'ok' && (await hasBroadPermissions(storePath))) {
    io.out('Warning: the credential store is readable by other users; restrict it with: chmod 600 <path>');
  }
  io.out("Values set only in the server's own process environment (for example by a service manager) are not visible here.");
  return 0;
}

/** Loads the store for modification, refusing to overwrite a file it cannot parse. */
async function loadForUpdate(envs: ServerEnv[]): Promise<{ path: string; data: StoreData }> {
  const storePath = storeLocation(envs);
  const store = await readStore(storePath);
  if (store.status === 'invalid') {
    throw new Error(`The credential store at ${storePath} is unreadable or has an unsupported format. Fix or remove it, then retry.`);
  }
  return { path: storePath, data: store.data };
}

function noteEnvOverride(io: AuthIO, envs: ServerEnv[], envName: string): void {
  const sources = overrideSources(envs, envName);
  if (sources.length > 0) {
    io.out(`Note: ${envName} is set in ${sources.join(' and ')} and takes precedence over the saved value.`);
  }
}

async function setCredential(io: AuthIO, name: string | undefined): Promise<number> {
  const target = name ? CREDENTIAL_NAMES[name] : undefined;
  if (!target) return usageError(io);
  const envs = loadServerEnvs(io.projectDir, io.env);

  const value = (await io.readSecret(`${target.label}: `)).trim();
  if (!isStorableValue(value) || !effectiveValue(value)) {
    io.err('Nothing saved: enter a single-line value of at most 512 characters.');
    return 1;
  }

  const store = await loadForUpdate(envs);
  store.data.credentials[target.field] = value;
  await writeStore(store.path, store.data);
  io.out(`Saved the ${target.label} to ${store.path}.`);
  noteEnvOverride(io, envs, CREDENTIAL_ENV[target.field]);
  return 0;
}

async function removeCredential(io: AuthIO, name: string | undefined): Promise<number> {
  const target = name ? CREDENTIAL_NAMES[name] : undefined;
  if (!target) return usageError(io);
  const envs = loadServerEnvs(io.projectDir, io.env);

  const store = await loadForUpdate(envs);
  if (!store.data.credentials[target.field]) {
    io.out(`No saved ${target.label}.`);
  } else {
    delete store.data.credentials[target.field];
    await writeStore(store.path, store.data);
    io.out(`Removed the saved ${target.label}.`);
  }
  noteEnvOverride(io, envs, CREDENTIAL_ENV[target.field]);
  return 0;
}

async function training(io: AuthIO, action: string | undefined): Promise<number> {
  switch (action) {
    case 'code':
      return setAccessCode(io);
    case 'rotate':
      return rotateAccessCode(io);
    case 'open':
    case 'close':
    case 'off':
      return setTrainingMode(io, action === 'close' ? 'closed' : action);
    default:
      return usageError(io);
  }
}

/** A saved access code has no effect while an environment code overrides it; say so instead of saving. */
function refuseOverriddenCode(io: AuthIO, envs: ServerEnv[]): boolean {
  const sources = overrideSources(envs, TRAINING_ENV.ACCESS_CODE);
  if (sources.length === 0) return false;
  io.err(
    `Nothing saved: ${TRAINING_ENV.ACCESS_CODE} is set in ${sources.join(' and ')} and overrides the saved code, ` +
      'so a new code would not take effect and existing sessions would keep working. ' +
      'Change or remove it there, then restart the server.'
  );
  return true;
}

async function setAccessCode(io: AuthIO): Promise<number> {
  const envs = loadServerEnvs(io.projectDir, io.env);
  if (refuseOverriddenCode(io, envs)) return 1;

  const code = (await io.readSecret('Training access code: ')).trim();
  const normalized = normalizeAccessCode(code);
  if (!isStorableValue(code) || !isUsableAccessCode(normalized)) {
    io.err(`Nothing saved: the code needs ${ACCESS_CODE_MIN_LENGTH}-${ACCESS_CODE_MAX_LENGTH} characters, ignoring spaces and hyphens.`);
    return 1;
  }
  const repeated = (await io.readSecret('Repeat the access code: ')).trim();
  if (normalizeAccessCode(repeated) !== normalized) {
    io.err('Nothing saved: the codes do not match.');
    return 1;
  }

  const store = await loadForUpdate(envs);
  store.data.training.accessCode = code;
  await writeStore(store.path, store.data);
  io.out('Saved the training access code. Sessions issued under a previous code no longer work.');
  return 0;
}

async function rotateAccessCode(io: AuthIO): Promise<number> {
  const envs = loadServerEnvs(io.projectDir, io.env);
  if (refuseOverriddenCode(io, envs)) return 1;

  const store = await loadForUpdate(envs);
  const code = generateAccessCode();
  store.data.training.accessCode = code;
  await writeStore(store.path, store.data);
  io.out(`New training access code: ${code}`);
  io.out('It is shown only now. Sessions issued under the previous code no longer work.');
  return 0;
}

async function setTrainingMode(io: AuthIO, mode: TrainingMode): Promise<number> {
  const envs = loadServerEnvs(io.projectDir, io.env);
  const store = await loadForUpdate(envs);
  const updated: StoreData = { ...store.data, training: { ...store.data.training, mode } };

  // Check the result the server would compute before saving anything.
  const effective = envs.map((e) => ({ e, config: resolveServerConfig(e.env, { status: 'ok', path: store.path, data: updated }) }));
  const blocked = effective.filter(({ config }) => config.training.mode !== mode);
  if (blocked.length > 0) {
    const sources = overrideSources(envs, TRAINING_ENV.MODE);
    const where = sources.length > 0 ? `${TRAINING_ENV.MODE} in ${sources.join(' and ')}` : 'the environment';
    io.err(
      `Nothing saved: ${where} keeps training ${blocked[0].config.training.mode} ` +
        `for ${blocked.map(({ e }) => commandFor(e.mode)).join(' and ')}. Change or remove it there, then retry.`
    );
    return 1;
  }

  await writeStore(store.path, updated);
  const messages: Record<TrainingMode, string> = {
    open: 'Training is open: AI analysis requires the access code.',
    closed: 'Training is closed: AI analysis is blocked for everyone.',
    off: 'Training mode is off: AI analysis needs no access code. Use this only when the server is not publicly reachable.',
  };
  io.out(messages[mode]);
  if (mode === 'open' && effective.some(({ config }) => !config.training.accessCode)) {
    io.out('Warning: no usable access code is configured, so AI analysis stays blocked. Run: npm run auth -- training rotate');
  }
  return 0;
}

async function readSecretFromTerminal(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    process.stderr.write('Input is not a terminal; reading one line from standard input.\n');
    let buffered = '';
    for await (const chunk of stdin) {
      buffered += chunk.toString();
      const newline = buffered.search(/\r?\n/);
      if (newline !== -1) return buffered.slice(0, newline);
    }
    return buffered;
  }

  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();

    const finish = (error?: Error) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(new Error('Cancelled.'));
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (char < ' ') continue;
        value += char;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const io: AuthIO = {
    env: process.env,
    projectDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    readSecret: readSecretFromTerminal,
  };
  runAuth(process.argv.slice(2), io).then((code) => {
    process.exitCode = code;
  });
}
