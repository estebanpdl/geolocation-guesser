// @vitest-environment node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyStore, readStore, writeStore } from '../credential-store';
import { makeScratchDir, SYNTHETIC } from '@/test/fakes';

afterEach(() => vi.restoreAllMocks());

describe('credential replacement failures', () => {
  it.each(['writeFile', 'sync', 'close', 'rename'] as const)(
    'preserves the saved store and removes temporary credentials after %s fails',
    async (stage) => {
      const dir = await makeScratchDir();
      const storePath = path.join(dir, 'credentials.json');
      const original = { ...emptyStore(), credentials: { geminiApiKey: SYNTHETIC.GEMINI_KEY } };
      await writeStore(storePath, original);
      const failure = new Error(`synthetic ${stage} failure`);

      if (stage === 'rename') {
        vi.spyOn(fs, 'rename').mockRejectedValueOnce(failure);
      } else {
        const open = fs.open;
        vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
          const handle = await open(...args);
          if (stage === 'writeFile') {
            const writeFile = handle.writeFile.bind(handle);
            vi.spyOn(handle, 'writeFile').mockImplementationOnce(async (...writeArgs) => {
              await writeFile(...writeArgs);
              throw failure;
            });
          } else if (stage === 'sync') {
            vi.spyOn(handle, 'sync').mockRejectedValueOnce(failure);
          } else {
            const close = handle.close.bind(handle);
            vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
              await close();
              throw failure;
            });
          }
          return handle;
        });
      }

      const replacement = { ...emptyStore(), credentials: { openaiApiKey: SYNTHETIC.OPENAI_KEY } };
      await expect(writeStore(storePath, replacement)).rejects.toBe(failure);
      expect((await readStore(storePath)).data).toEqual(original);
      expect(await fs.readdir(dir)).toEqual(['credentials.json']);
    }
  );
});
