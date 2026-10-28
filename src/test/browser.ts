/** Fakes for component tests: a same-origin fetch router and catalog fixtures. */
import { vi } from 'vitest';
import type { PublicCatalog } from '@/lib/analysis/contract';
import { SAMPLE_ANALYSIS } from './fakes';

export interface BrowserCall {
  path: string;
  method: string;
  body: Record<string, unknown> | null;
}

type Handler = (call: BrowserCall) => Response | Promise<Response>;

/** Routes relative `fetch` calls by path; unknown paths fail the test. */
export function installBrowserFetch(routes: Record<string, Handler>) {
  const calls: BrowserCall[] = [];
  const fake = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const call: BrowserCall = {
      path,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const handler = routes[path];
    if (!handler) throw new Error(`No fake response for ${path}`);
    return handler(call);
  });
  vi.stubGlobal('fetch', fake);
  return { calls, fake, posts: (path: string) => calls.filter((c) => c.path === path && c.method === 'POST') };
}

export function publicCatalogFixture(operatorCredentials = true): PublicCatalog {
  return {
    providers: [
      {
        id: 'gemini',
        label: 'Gemini',
        operatorCredentials,
        participantKeys: true,
        models: [{ id: 'gemini-flash', label: 'Gemini Flash', workflows: ['scene', 'photo'], default: true }],
      },
    ],
    defaultSelection: { provider: 'gemini', model: 'gemini-flash' },
  };
}

export function catalogRoute(catalog: PublicCatalog = publicCatalogFixture()): Handler {
  return () => Response.json({ catalog, requestId: 'catalog' });
}

/** A successful analysis whose credential source mirrors the request. */
export function analysisRoute(): Handler {
  return ({ body }) =>
    Response.json({
      analysis: SAMPLE_ANALYSIS,
      selection: body?.selection ?? { provider: 'gemini', model: 'gemini-flash' },
      credentialSource: body?.participantKey ? 'participant' : 'operator',
      requestId: 'analysis',
    });
}

export function errorRoute(status: number, code: string, error = 'Request failed.'): Handler {
  return () => Response.json({ error, code, requestId: 'error' }, { status });
}

/** Everything the browser could persist a value in, as one string. */
export function persistedBrowserState(): string {
  const stores = [window.localStorage, window.sessionStorage].map((store) =>
    Array.from({ length: store.length }, (_, i) => `${store.key(i)}=${store.getItem(store.key(i) ?? '')}`).join(';')
  );
  return [...stores, document.cookie, window.location.href, window.history.state ? JSON.stringify(window.history.state) : ''].join('|');
}
