/**
 * Operator command for server-side credentials and training access.
 *
 *   npm run auth -- <command>
 *
 * Secrets are entered at a masked prompt and saved to the per-user credential
 * store. Status output reports only whether each setting is configured and
 * where it comes from, never the value.
 */
import { pathToFileURL } from 'node:url';
import {
  hasBroadPermissions,
  isStorableValue,
  readStore,
  resolveStorePath,
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

export interface AuthIO {
  env: Record<string, string | undefined>;
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

Environment variables override saved values: ${Object.values(CREDENTIAL_ENV).join(', ')},
${TRAINING_ENV.MODE}, ${TRAINING_ENV.ACCESS_CODE}. Changes apply to a running server on its
next request. Rotating the code ends existing training sessions.`;

export async function runAuth(args: string[], io: AuthIO): Promise<number> {
  const [command = 'status', subject, ...rest] = args;
  try {
    if (rest.length > 0) return usageError(io);
    switch (command) {
      case 'status':
        return subject ? usageError(io) : await status(io);
      case 'path':
        if (subject) return usageError(io);
        io.out(resolveStorePath(io.env));
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

async function status(io: AuthIO): Promise<number> {
  const storePath = resolveStorePath(io.env);
  const store = await readStore(storePath);
  for (const line of describeServerConfig(resolveServerConfig(io.env, store))) io.out(line);
  if (store.status === 'ok' && (await hasBroadPermissions(storePath))) {
    io.out('Warning: the credential store is readable by other users; restrict it with: chmod 600 <path>');
  }
  io.out('Environment values shown are from this shell; the server also reads its own environment and .env files.');
  return 0;
}

/** Loads the store for modification, refusing to overwrite a file it cannot parse. */
async function loadForUpdate(io: AuthIO): Promise<{ path: string; data: StoreData }> {
  const storePath = resolveStorePath(io.env);
  const store = await readStore(storePath);
  if (store.status === 'invalid') {
    throw new Error(`The credential store at ${storePath} is unreadable or has an unsupported format. Fix or remove it, then retry.`);
  }
  return { path: storePath, data: store.data };
}

function noteEnvOverride(io: AuthIO, envName: string): void {
  if (effectiveValue(io.env[envName])) {
    io.out(`Note: ${envName} is set in this environment and takes precedence over the saved value.`);
  }
}

async function setCredential(io: AuthIO, name: string | undefined): Promise<number> {
  const target = name ? CREDENTIAL_NAMES[name] : undefined;
  if (!target) return usageError(io);

  const value = (await io.readSecret(`${target.label}: `)).trim();
  if (!isStorableValue(value) || !effectiveValue(value)) {
    io.err('Nothing saved: enter a single-line value of at most 512 characters.');
    return 1;
  }

  const store = await loadForUpdate(io);
  store.data.credentials[target.field] = value;
  await writeStore(store.path, store.data);
  io.out(`Saved the ${target.label} to ${store.path}.`);
  noteEnvOverride(io, CREDENTIAL_ENV[target.field]);
  return 0;
}

async function removeCredential(io: AuthIO, name: string | undefined): Promise<number> {
  const target = name ? CREDENTIAL_NAMES[name] : undefined;
  if (!target) return usageError(io);

  const store = await loadForUpdate(io);
  if (!store.data.credentials[target.field]) {
    io.out(`No saved ${target.label}.`);
    return 0;
  }
  delete store.data.credentials[target.field];
  await writeStore(store.path, store.data);
  io.out(`Removed the saved ${target.label}.`);
  noteEnvOverride(io, CREDENTIAL_ENV[target.field]);
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

async function setAccessCode(io: AuthIO): Promise<number> {
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

  const store = await loadForUpdate(io);
  store.data.training.accessCode = code;
  await writeStore(store.path, store.data);
  io.out('Saved the training access code. Sessions issued under a previous code no longer work.');
  noteEnvOverride(io, TRAINING_ENV.ACCESS_CODE);
  return 0;
}

async function rotateAccessCode(io: AuthIO): Promise<number> {
  const store = await loadForUpdate(io);
  const code = generateAccessCode();
  store.data.training.accessCode = code;
  await writeStore(store.path, store.data);
  io.out(`New training access code: ${code}`);
  io.out('It is shown only now. Sessions issued under the previous code no longer work.');
  noteEnvOverride(io, TRAINING_ENV.ACCESS_CODE);
  return 0;
}

async function setTrainingMode(io: AuthIO, mode: TrainingMode): Promise<number> {
  const store = await loadForUpdate(io);
  store.data.training.mode = mode;
  await writeStore(store.path, store.data);

  const messages: Record<TrainingMode, string> = {
    open: 'Training is open: AI analysis requires the access code.',
    closed: 'Training is closed: AI analysis is blocked for everyone.',
    off: 'Training mode is off: AI analysis needs no access code. Use this only when the server is not publicly reachable.',
  };
  io.out(messages[mode]);
  if (mode === 'open') {
    const config = resolveServerConfig(io.env, { status: 'ok', path: store.path, data: store.data });
    if (!config.training.accessCode) {
      io.out('Warning: no usable access code is configured, so AI analysis stays blocked. Run: npm run auth -- training rotate');
    }
  }
  noteEnvOverride(io, TRAINING_ENV.MODE);
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
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    readSecret: readSecretFromTerminal,
  };
  runAuth(process.argv.slice(2), io).then((code) => {
    process.exitCode = code;
  });
}
