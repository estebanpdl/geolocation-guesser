// @vitest-environment node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadServerEnv, SHELL_SOURCE } from '../project-env.ts';
import { makeScratchDir } from '../../src/test/fakes';

async function project(files: Record<string, string>): Promise<string> {
  const dir = await makeScratchDir('project-');
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(dir, name), content, 'utf8');
  return dir;
}

describe('loadServerEnv', () => {
  it('applies Next.js file precedence and lets the shell win', async () => {
    const dir = await project({
      '.env': 'A=env\nB=env\nC=env\nD=env\nE=env\n',
      '.env.production': 'A=production\nB=production\nC=production\n',
      '.env.local': 'A=local\nB=local\n',
      '.env.production.local': 'A=production-local\n',
      '.env.development': 'E=development\n',
    });
    const result = loadServerEnv(dir, { D: 'shell' }, 'production');

    expect(result.env).toMatchObject({ A: 'production-local', B: 'local', C: 'production', D: 'shell', E: 'env' });
    expect(result.sources).toMatchObject({ A: '.env.production.local', B: '.env.local', C: '.env.production', D: SHELL_SOURCE, E: '.env' });
    expect(result.loadedFiles).toEqual(['.env.production.local', '.env.local', '.env.production', '.env']);
  });

  it('reads development files for next dev', async () => {
    const dir = await project({ '.env.development': 'E=development\n', '.env.production': 'E=production\n' });
    expect(loadServerEnv(dir, {}, 'development').env.E).toBe('development');
  });

  it('keeps a blank shell value over a file value', async () => {
    const dir = await project({ '.env.local': 'TRAINING_ACCESS_CODE=from-file\n' });
    expect(loadServerEnv(dir, { TRAINING_ACCESS_CODE: '' }, 'production').env.TRAINING_ACCESS_CODE).toBe('');
  });

  it('handles a project without .env files', async () => {
    const dir = await project({});
    expect(loadServerEnv(dir, {}, 'production')).toMatchObject({ env: {}, loadedFiles: [] });
  });
});
