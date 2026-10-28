/**
 * The environment a Next.js server for this project sees: its process
 * environment plus the project's .env files, in the order Next loads them.
 * Earlier files win over later ones and the process environment wins over all
 * files. `$VAR` expansion is not applied; values are used as written.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

type Env = Record<string, string | undefined>;

/** `next start` runs in production mode, `next dev` in development mode. */
export const SERVER_RUN_MODES = ['production', 'development'] as const;
export type ServerRunMode = (typeof SERVER_RUN_MODES)[number];

export const SHELL_SOURCE = 'shell environment';

export interface ServerEnv {
  mode: ServerRunMode;
  env: Env;
  /** Where each variable came from: SHELL_SOURCE or a .env file name. */
  sources: Record<string, string>;
  loadedFiles: string[];
}

export function envFilesFor(mode: ServerRunMode): string[] {
  return [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env'];
}

export function loadServerEnv(projectDir: string, processEnv: Env, mode: ServerRunMode): ServerEnv {
  const env: Env = {};
  const sources: Record<string, string> = {};
  const loadedFiles: string[] = [];

  for (const file of envFilesFor(mode)) {
    let content: string;
    try {
      content = readFileSync(path.join(projectDir, file), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new Error(`Could not read ${file} in ${projectDir}.`);
    }
    loadedFiles.push(file);
    for (const [name, value] of Object.entries(parseEnv(content))) {
      if (!(name in env)) {
        env[name] = value;
        sources[name] = file;
      }
    }
  }

  for (const [name, value] of Object.entries(processEnv)) {
    if (value === undefined) continue;
    env[name] = value;
    sources[name] = SHELL_SOURCE;
  }
  return { mode, env, sources, loadedFiles };
}

export function loadServerEnvs(projectDir: string, processEnv: Env): ServerEnv[] {
  return SERVER_RUN_MODES.map((mode) => loadServerEnv(projectDir, processEnv, mode));
}

export function commandFor(mode: ServerRunMode): string {
  return mode === 'production' ? 'next start' : 'next dev';
}
