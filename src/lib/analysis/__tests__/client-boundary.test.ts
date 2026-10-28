// @vitest-environment node
/**
 * Static import-graph check: nothing a browser bundle can load may reach
 * server modules, provider SDKs or Node built-ins.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../..');
const SERVER_DIR = path.join(SRC, 'lib', 'server') + path.sep;
const FORBIDDEN_PACKAGES = [/^@google\/generative-ai/, /^@google\/genai/, /^openai/, /^node:/, /^fs$/, /^crypto$/];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' || name === 'test' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/') ? path.join(SRC, specifier.slice(2)) : path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Value and type imports alike: a type import of a server module still couples the bundle to it. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2]);
}

function violations(entry: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const visit = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of importsOf(file)) {
      const here = [...chain, path.relative(SRC, file)];
      if (FORBIDDEN_PACKAGES.some((re) => re.test(specifier))) {
        found.push(`${here.join(' -> ')} -> ${specifier}`);
        continue;
      }
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
      const resolved = resolveImport(file, specifier);
      if (!resolved) continue;
      if (resolved.startsWith(SERVER_DIR)) {
        found.push(`${here.join(' -> ')} -> ${path.relative(SRC, resolved)}`);
        continue;
      }
      visit(resolved, here);
    }
  };
  visit(entry, []);
  return found;
}

const clientEntries = sourceFiles(SRC).filter((file) => /^\s*['"]use client['"]/.test(readFileSync(file, 'utf8')));

describe('client import boundary', () => {
  it('finds the client entry points', () => {
    const names = clientEntries.map((f) => path.relative(SRC, f).replace(/\\/g, '/'));
    expect(names).toEqual(
      expect.arrayContaining([
        'components/AIAssistantPanel.tsx',
        'components/ParticipantKeyField.tsx',
        'components/TrainingNavLink.tsx',
        'app/analyze/page.tsx',
        'app/game/page.tsx',
        'lib/participant-keys.ts',
      ])
    );
  });

  it('keeps the shared contract free of imports', () => {
    expect(importsOf(path.join(SRC, 'lib', 'analysis', 'contract.ts'))).toEqual([]);
  });

  it.each(clientEntries.map((f) => [path.relative(SRC, f), f]))('%s reaches no server or SDK code', (_name, file) => {
    expect(violations(file)).toEqual([]);
  });

  it('detects a violation', () => {
    expect(violations(path.join(SRC, 'app', 'api', 'ai-analysis', 'route.ts')).length).toBeGreaterThan(0);
  });
});
