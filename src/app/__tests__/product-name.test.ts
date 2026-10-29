// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { metadata } from '../layout';

const root = path.resolve(__dirname, '../../..');
const readJson = (file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));

describe('product name', () => {
  it('is the page title', () => {
    expect(metadata.title).toBe('Geolocation Guesser');
  });

  it('matches between the package manifest and the lockfile', () => {
    const lock = readJson('package-lock.json');
    expect([readJson('package.json').name, lock.name, lock.packages[''].name]).toEqual(Array(3).fill('geolocation-guesser'));
  });
});
