// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api-error';
import { CATALOG, catalogProblems, publicCatalog, resolveSelection, type Catalog } from '../catalog';
import { emptyStore } from '../credential-store';
import { resolveServerConfig } from '../server-config';
import { catalogModel as model, SYNTHETIC, TWO_PROVIDER_CATALOG } from '@/test/fakes';

function config(env: Record<string, string> = {}) {
  return resolveServerConfig(env, { status: 'missing', path: null, data: emptyStore() });
}

function selectionError(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error('expected an ApiError');
}

describe('CATALOG', () => {
  it('is structurally valid with one listed default per enabled provider', () => {
    expect(catalogProblems(CATALOG)).toEqual([]);
    expect(catalogProblems(TWO_PROVIDER_CATALOG)).toEqual([]);
  });

  it('offers both providers, with OpenAI limited to photos while Street View imagery is not permitted for it', () => {
    expect(CATALOG.providers.find((p) => p.id === 'openai')).toMatchObject({ enabled: true, participantKeys: true, streetViewImagery: false });
    expect(publicCatalog(config()).providers.map((p) => [p.id, p.models.map((m) => [m.id, m.workflows, m.default])])).toEqual([
      [
        'gemini',
        [
          ['gemini-3.5-flash-lite', ['scene', 'photo'], true],
          ['gemini-3.8-flash', ['scene', 'photo'], false],
        ],
      ],
      [
        'openai',
        [
          ['gpt-6-luna', ['photo'], true],
          ['gpt-6.1-terra', ['photo'], false],
        ],
      ],
    ]);
  });

  it('pins exact upstream model IDs rather than moving aliases', () => {
    for (const entry of CATALOG.models) expect(entry.upstreamModel).not.toMatch(/latest|preview/);
  });

  it('defaults to a Gemini entry available for both workflows', () => {
    expect(resolveSelection(undefined, 'scene').model).toMatchObject({ id: 'gemini-3.5-flash-lite', provider: 'gemini' });
    expect(resolveSelection(undefined, 'photo').model.id).toBe('gemini-3.5-flash-lite');
  });

  it('requires the default selection to stay available for scenes', () => {
    const noStreetView: Catalog = {
      ...TWO_PROVIDER_CATALOG,
      providers: TWO_PROVIDER_CATALOG.providers.map((p) => (p.id === 'gemini' ? { ...p, streetViewImagery: false } : p)),
    };
    expect(catalogProblems(noStreetView)).toContain('defaultSelection must support both workflows');
  });

  it('reports structural problems', () => {
    const broken: Catalog = {
      ...TWO_PROVIDER_CATALOG,
      models: [
        model({ id: 'gem-default', provider: 'gemini', default: true }),
        model({ id: 'gem-default', provider: 'gemini', default: true }),
        model({ id: 'Bad ID', provider: 'gemini' }),
        model({ id: 'oa-a', provider: 'openai' }),
      ],
    };
    expect(catalogProblems(broken)).toEqual(
      expect.arrayContaining([
        'duplicate id gem-default',
        'invalid id Bad ID',
        'provider gemini needs exactly one default',
        'provider openai needs exactly one default',
      ])
    );
  });
});

describe('publicCatalog', () => {
  it('lists enabled providers and listed entries without credentials or upstream names', () => {
    const projection = publicCatalog(
      config({ GOOGLE_GENERATIVE_AI_KEY: SYNTHETIC.GEMINI_KEY, OPENAI_API_KEY: SYNTHETIC.OPENAI_KEY }),
      TWO_PROVIDER_CATALOG
    );
    expect(projection.providers.map((p) => [p.id, p.models.map((m) => m.id)])).toEqual([
      ['gemini', ['gem-default', 'gem-photo']],
      ['openai', ['oa-default']],
    ]);
    const text = JSON.stringify(projection);
    expect(text).not.toContain(SYNTHETIC.GEMINI_KEY);
    expect(text).not.toContain(SYNTHETIC.OPENAI_KEY);
    expect(text).not.toContain('upstream-');
    expect(text).not.toContain('credentialField');
  });

  it('reports operator credentials per provider without hiding a provider that lacks them', () => {
    const projection = publicCatalog(config({ GOOGLE_GENERATIVE_AI_KEY: SYNTHETIC.GEMINI_KEY }), TWO_PROVIDER_CATALOG);
    expect(projection.providers.map((p) => [p.id, p.operatorCredentials, p.participantKeys])).toEqual([
      ['gemini', true, true],
      ['openai', false, true],
    ]);
  });
});

describe('resolveSelection', () => {
  it('resolves an exact provider and catalog ID pair', () => {
    const { provider, model: entry } = resolveSelection({ provider: 'openai', model: 'oa-default' }, 'photo', TWO_PROVIDER_CATALOG);
    expect([provider.id, entry.upstreamModel]).toEqual(['openai', 'upstream-oa-default']);
  });

  it.each([
    ['null', null, 400, 'invalid_selection'],
    ['an array', [], 400, 'invalid_selection'],
    ['a bare string', 'gem-default', 400, 'invalid_selection'],
    ['a missing model', { provider: 'gemini' }, 400, 'invalid_selection'],
    ['a numeric model', { provider: 'gemini', model: 1 }, 400, 'invalid_selection'],
    ['an unknown provider', { provider: 'anthropic', model: 'gem-default' }, 400, 'unknown_provider'],
    ['an unknown (stale) model', { provider: 'gemini', model: 'gem-retired' }, 400, 'unknown_model'],
    ['an upstream name instead of a catalog ID', { provider: 'gemini', model: 'upstream-gem-default' }, 400, 'unknown_model'],
    ['a prefix of a catalog ID', { provider: 'gemini', model: 'gem' }, 400, 'unknown_model'],
    ['an entry without image input', { provider: 'gemini', model: 'gem-text-only' }, 400, 'unknown_model'],
    ['a mismatched pair', { provider: 'openai', model: 'gem-default' }, 400, 'selection_mismatch'],
    ['a photo-only entry for a scene', { provider: 'gemini', model: 'gem-photo' }, 400, 'workflow_unsupported'],
  ])('rejects %s without falling back', (_label, input, status, code) => {
    const err = selectionError(() => resolveSelection(input, 'scene', TWO_PROVIDER_CATALOG));
    expect([err.status, err.code]).toEqual([status, code]);
  });

  it('refuses a disabled provider with 503', () => {
    const disabled: Catalog = {
      ...TWO_PROVIDER_CATALOG,
      providers: TWO_PROVIDER_CATALOG.providers.map((p) => (p.id === 'openai' ? { ...p, enabled: false } : p)),
    };
    const err = selectionError(() => resolveSelection({ provider: 'openai', model: 'oa-default' }, 'photo', disabled));
    expect([err.status, err.code]).toEqual([503, 'provider_unavailable']);
  });

  it('refuses Street View analysis for a provider not permitted to receive it, but not photos', () => {
    const err = selectionError(() => resolveSelection({ provider: 'openai', model: 'gpt-6-luna' }, 'scene'));
    expect([err.status, err.code]).toEqual([403, 'street_view_not_permitted']);
    expect(resolveSelection({ provider: 'openai', model: 'gpt-6-luna' }, 'photo').model.upstreamModel).toBe('gpt-6-luna');
  });
});
