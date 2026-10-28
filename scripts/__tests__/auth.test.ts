// @vitest-environment node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAuth, type AuthIO } from '../auth.ts';
import { loadServerEnv } from '../project-env.ts';
import { readStore } from '../../src/lib/server/credential-store.ts';
import { resolveServerConfig } from '../../src/lib/server/server-config.ts';
import { makeScratchDir, SYNTHETIC } from '../../src/test/fakes';

interface Harness {
  io: AuthIO;
  out: string[];
  err: string[];
  prompts: string[];
  storePath: string;
  projectDir: string;
}

/** A synthetic project directory with optional .env files, plus a scratch store. */
async function harness(
  secrets: string[] = [],
  env: Record<string, string> = {},
  envFiles: Record<string, string> = {}
): Promise<Harness> {
  const storePath = path.join(await makeScratchDir('auth-'), 'credentials.json');
  const projectDir = await makeScratchDir('project-');
  for (const [name, content] of Object.entries(envFiles)) {
    await fs.writeFile(path.join(projectDir, name), content, 'utf8');
  }
  const out: string[] = [];
  const err: string[] = [];
  const prompts: string[] = [];
  const queue = [...secrets];
  return {
    out,
    err,
    prompts,
    storePath,
    projectDir,
    io: {
      env: { GEOLOCATION_GUESSER_CREDENTIALS_FILE: storePath, ...env },
      projectDir,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      readSecret: async (prompt) => {
        prompts.push(prompt);
        return queue.shift() ?? '';
      },
    },
  };
}

async function stored(h: Harness) {
  return (await readStore(h.storePath)).data;
}

/** The training settings a `next start` server for the harness project would apply. */
async function serverTraining(h: Harness) {
  const { env } = loadServerEnv(h.projectDir, h.io.env, 'production');
  return resolveServerConfig(env, await readStore(h.storePath)).training;
}

describe('auth command', () => {
  it('saves a credential from the masked prompt without printing it', async () => {
    const h = await harness([SYNTHETIC.GEMINI_KEY]);
    expect(await runAuth(['set', 'gemini'], h.io)).toBe(0);
    expect(h.prompts).toEqual(['Gemini API key: ']);
    expect((await stored(h)).credentials.geminiApiKey).toBe(SYNTHETIC.GEMINI_KEY);
    expect(h.out.join('\n')).not.toContain(SYNTHETIC.GEMINI_KEY);
  });

  it('notes when an environment variable overrides the saved value', async () => {
    const h = await harness([SYNTHETIC.MAPS_SERVER_KEY], { GOOGLE_MAPS_API_KEY: 'env-value' });
    expect(await runAuth(['set', 'maps-server'], h.io)).toBe(0);
    expect(h.out.join('\n')).toContain('GOOGLE_MAPS_API_KEY is set in shell environment and takes precedence');
  });

  it('refuses empty and placeholder values', async () => {
    const h = await harness(['   ', 'your_gemini_api_key_here']);
    expect(await runAuth(['set', 'gemini'], h.io)).toBe(1);
    expect(await runAuth(['set', 'gemini'], h.io)).toBe(1);
    await expect(fs.access(h.storePath)).rejects.toThrow();
  });

  it('removes a saved credential', async () => {
    const h = await harness([SYNTHETIC.OPENAI_KEY]);
    await runAuth(['set', 'openai'], h.io);
    expect(await runAuth(['remove', 'openai'], h.io)).toBe(0);
    expect((await stored(h)).credentials.openaiApiKey).toBeUndefined();
  });

  it('shows status without values', async () => {
    const h = await harness([SYNTHETIC.GEMINI_KEY], { TRAINING_ACCESS_CODE: SYNTHETIC.ACCESS_CODE });
    await runAuth(['set', 'gemini'], h.io);
    h.out.length = 0;
    expect(await runAuth(['status'], h.io)).toBe(0);
    const text = h.out.join('\n');
    expect(text).toContain(`Credential store: ${h.storePath} (present)`);
    expect(text).toContain('Gemini API key: configured (credential store)');
    expect(text).toContain('Training access code: configured (environment)');
    expect(text).not.toContain(SYNTHETIC.GEMINI_KEY);
    expect(text).not.toContain(SYNTHETIC.ACCESS_CODE);
  });

  it('rotates the access code and shows the new code once', async () => {
    const h = await harness();
    expect(await runAuth(['training', 'rotate'], h.io)).toBe(0);
    const code = (await stored(h)).training.accessCode;
    expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(h.out.filter((line) => line.includes(code as string))).toHaveLength(1);

    await runAuth(['training', 'rotate'], h.io);
    expect((await stored(h)).training.accessCode).not.toBe(code);
  });

  it('saves a confirmed access code and rejects short or mismatched ones', async () => {
    const h = await harness(['short', 'abcd-efgh-2345', 'abcd-efgh-9999', 'abcd-efgh-2345', 'ABCD EFGH 2345']);
    expect(await runAuth(['training', 'code'], h.io)).toBe(1);
    expect(await runAuth(['training', 'code'], h.io)).toBe(1);
    await expect(fs.access(h.storePath)).rejects.toThrow();
    expect(await runAuth(['training', 'code'], h.io)).toBe(0);
    expect((await stored(h)).training.accessCode).toBe('abcd-efgh-2345');
  });

  it('sets the training mode and warns when opening without a code', async () => {
    const h = await harness();
    expect(await runAuth(['training', 'open'], h.io)).toBe(0);
    expect(h.out.join('\n')).toContain('no usable access code is configured');
    expect(await runAuth(['training', 'close'], h.io)).toBe(0);
    expect((await stored(h)).training.mode).toBe('closed');
    expect(await runAuth(['training', 'off'], h.io)).toBe(0);
    expect((await stored(h)).training.mode).toBe('off');
  });

  it('does not overwrite a store it cannot parse', async () => {
    const h = await harness([SYNTHETIC.GEMINI_KEY]);
    await fs.mkdir(path.dirname(h.storePath), { recursive: true });
    await fs.writeFile(h.storePath, '{ broken');
    expect(await runAuth(['set', 'gemini'], h.io)).toBe(1);
    expect(h.err.join('\n')).toContain('unreadable or has an unsupported format');
    expect(await fs.readFile(h.storePath, 'utf8')).toBe('{ broken');
  });

  describe('with settings in the project .env files', () => {
    const envLocal = `TRAINING_MODE=open\nTRAINING_ACCESS_CODE=${SYNTHETIC.ACCESS_CODE}\n`;

    it('closes training on the server even when .env.local opens it', async () => {
      const h = await harness([], {}, { '.env.local': envLocal });
      expect((await serverTraining(h)).mode).toBe('open');

      expect(await runAuth(['training', 'close'], h.io)).toBe(0);
      expect(h.out.join('\n')).toContain('Training is closed');
      expect(await serverTraining(h)).toMatchObject({ mode: 'closed', modeSource: 'store' });
    });

    it('refuses to rotate or set a code that .env.local overrides', async () => {
      const h = await harness(['NEWCODE-2345-ABCD', 'NEWCODE-2345-ABCD'], {}, { '.env.local': envLocal });
      expect(await runAuth(['training', 'rotate'], h.io)).toBe(1);
      expect(await runAuth(['training', 'code'], h.io)).toBe(1);
      expect(h.prompts).toEqual([]);
      expect(h.out.join('\n')).not.toMatch(/New training access code/);
      expect(h.err.join('\n')).toContain('TRAINING_ACCESS_CODE is set in .env.local and overrides the saved code');
      await expect(fs.access(h.storePath)).rejects.toThrow();
      expect((await serverTraining(h)).accessCode?.value).toBe('TESTCODEABCD2345');
    });

    it('refuses a mode change that a development .env file overrides', async () => {
      const h = await harness([], {}, { '.env.development': 'TRAINING_MODE=open\n' });
      expect(await runAuth(['training', 'off'], h.io)).toBe(1);
      expect(h.err.join('\n')).toContain('TRAINING_MODE in .env.development (next dev) keeps training open for next dev');
      await expect(fs.access(h.storePath)).rejects.toThrow();
    });

    it('lets a blank shell value mask a file value, as the server does', async () => {
      const h = await harness([], { TRAINING_ACCESS_CODE: '' }, { '.env.local': envLocal });
      expect(await runAuth(['training', 'rotate'], h.io)).toBe(0);
      expect((await serverTraining(h)).accessCode?.source).toBe('store');
    });

    it('reports settings from .env files in status', async () => {
      const h = await harness([], {}, { '.env.local': envLocal, '.env.development.local': 'TRAINING_MODE=closed\n' });
      expect(await runAuth(['status'], h.io)).toBe(0);
      const text = h.out.join('\n');
      expect(text).toContain('Settings for next start (shell environment, .env.local):');
      expect(text).toContain('Training mode: open (environment)');
      expect(text).toContain('Training access code: configured (environment)');
      expect(text).toContain('Differences under next dev (shell environment, .env.development.local, .env.local):');
      expect(text).toContain('Training mode: closed (environment)');
      expect(text).not.toContain(SYNTHETIC.ACCESS_CODE);
    });

    it('uses a store location set in .env.local and rejects conflicting ones', async () => {
      const h = await harness();
      const elsewhere = path.join(await makeScratchDir('alt-'), 'credentials.json');
      const shell = { ...h.io.env };
      delete shell.GEOLOCATION_GUESSER_CREDENTIALS_FILE;
      const io = { ...h.io, env: shell };

      await fs.writeFile(path.join(h.projectDir, '.env.local'), `GEOLOCATION_GUESSER_CREDENTIALS_FILE=${elsewhere}\n`);
      expect(await runAuth(['path'], io)).toBe(0);
      expect(h.out).toEqual([elsewhere]);

      await fs.writeFile(
        path.join(h.projectDir, '.env.development.local'),
        `GEOLOCATION_GUESSER_CREDENTIALS_FILE=${h.storePath}\n`
      );
      expect(await runAuth(['training', 'close'], io)).toBe(1);
      expect(h.err.join('\n')).toContain('different credential stores');
    });
  });

  it('prints the store path and rejects unknown commands', async () => {
    const h = await harness();
    expect(await runAuth(['path'], h.io)).toBe(0);
    expect(h.out).toEqual([h.storePath]);
    expect(await runAuth(['set', 'unknown'], h.io)).toBe(2);
    expect(await runAuth(['training', 'reset'], h.io)).toBe(2);
    expect(await runAuth(['status', 'extra'], h.io)).toBe(2);
  });
});
