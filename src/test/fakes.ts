/** Synthetic fixtures and fake network boundaries for offline tests. */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import type { Analysis } from '@/lib/analysis/contract';
import type { Catalog, CatalogModel } from '@/lib/server/catalog';
import type { StoreData } from '@/lib/server/credential-store';

export const SYNTHETIC = {
  GEMINI_KEY: 'synthetic-gemini-key-0000',
  MAPS_SERVER_KEY: 'synthetic-maps-server-key-0000',
  MAPS_BROWSER_KEY: 'synthetic-maps-browser-key-0000',
  OPENAI_KEY: 'synthetic-openai-key-0000',
  ACCESS_CODE: 'TEST-CODE-ABCD-2345',
  PARTICIPANT_GEMINI_KEY_A: 'synthetic-participant-a-gemini-1111',
  PARTICIPANT_GEMINI_KEY_B: 'synthetic-participant-b-gemini-2222',
  PARTICIPANT_OPENAI_KEY: 'synthetic-participant-openai-3333',
} as const;

// ---------------------------------------------------------------------------
// Images: valid signatures and headers with chosen dimensions (not decodable pictures).

function withPadding(header: number[], total = 256): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.max(total, header.length));
  bytes.set(header);
  return bytes;
}

export function syntheticJpeg(width = 640, height = 640): Uint8Array<ArrayBuffer> {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  return withPadding([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

export function syntheticPng(width = 640, height = 480): Uint8Array<ArrayBuffer> {
  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return withPadding([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(width), ...u32(height),
    0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
}

export function syntheticWebp(width = 800, height = 600): Uint8Array<ArrayBuffer> {
  const u24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  return withPadding([
    ...ascii('RIFF'), 0xf8, 0x00, 0x00, 0x00, ...ascii('WEBP'),
    ...ascii('VP8X'), 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ...u24(width - 1), ...u24(height - 1),
  ]);
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

// ---------------------------------------------------------------------------
// Fake fetch: routes each request to a handler and records every call.

export interface RecordedCall {
  url: URL;
  init: RequestInit | undefined;
}

export type FakeRoute = (url: URL, init: RequestInit | undefined) => Response | Promise<Response | undefined> | undefined;

export function installFakeFetch(...routes: FakeRoute[]) {
  const calls: RecordedCall[] = [];
  const fake = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ url, init });
    for (const route of routes) {
      const response = await route(url, init);
      if (response) return response;
    }
    throw new Error(`No fake response for ${url.origin}${url.pathname}`);
  });
  vi.stubGlobal('fetch', fake);
  return { calls, fake };
}

export const isStreetView = (url: URL) => url.hostname === 'maps.googleapis.com' && url.pathname === '/maps/api/streetview';
export const isGemini = (url: URL) => url.hostname === 'generativelanguage.googleapis.com';
export const isOpenAI = (url: URL) => url.hostname === 'api.openai.com';

export function streetViewImage(bytes: Uint8Array<ArrayBuffer> = syntheticJpeg(), contentType = 'image/jpeg'): FakeRoute {
  return (url) => (isStreetView(url) ? new Response(bytes, { status: 200, headers: { 'content-type': contentType } }) : undefined);
}

export function streetViewStatus(status: number): FakeRoute {
  return (url) => (isStreetView(url) ? new Response('upstream detail that must not leak', { status }) : undefined);
}

export const SAMPLE_ANALYSIS: Analysis = {
  textAndSigns: 'Cyrillic shop sign.',
  landmarksAndBuildings: 'Soviet-era apartment blocks.',
  roadAndInfrastructure: 'Right-hand traffic.',
  vehiclesAndPlates: 'White plates.',
  vegetationAndTerrain: 'Birch trees, flat land.',
  culturalIndicators: 'No clear indicators.',
  overallAssessment: 'Eastern Europe, low confidence.',
};

export const SAMPLE_ANALYSIS_JSON = JSON.stringify(SAMPLE_ANALYSIS);

/** A Gemini reply whose text is `text` (the sample analysis as JSON by default). */
export function geminiText(text: string = SAMPLE_ANALYSIS_JSON, finishReason = 'STOP'): FakeRoute {
  return (url) =>
    isGemini(url)
      ? Response.json({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason, index: 0 }] })
      : undefined;
}

/** The key a fake Gemini request was sent with. */
export function geminiKeyOf(call: RecordedCall): string | null {
  return new Headers(call.init?.headers).get('x-goog-api-key');
}

export function geminiStatus(status: number): FakeRoute {
  return (url) =>
    isGemini(url)
      ? Response.json({ error: { code: status, message: 'upstream detail that must not leak', status: 'ERROR' } }, { status })
      : undefined;
}

/** Gemini's report of an invalid key: 400 INVALID_ARGUMENT with an `API_KEY_INVALID` reason. */
export function geminiKeyInvalid(): FakeRoute {
  return (url) =>
    isGemini(url)
      ? Response.json(
          {
            error: {
              code: 400,
              message: 'upstream detail that must not leak',
              status: 'INVALID_ARGUMENT',
              details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }],
            },
          },
          { status: 400 }
        )
      : undefined;
}

export function geminiBlocked(): FakeRoute {
  return (url) =>
    isGemini(url)
      ? Response.json({ promptFeedback: { blockReason: 'SAFETY', safetyRatings: [] } })
      : undefined;
}

/** A Responses API result with the given message content, status and incomplete reason. */
export function openaiResponse(
  content: Record<string, unknown>[] = [{ type: 'output_text', text: SAMPLE_ANALYSIS_JSON, annotations: [] }],
  status = 'completed',
  incompleteReason?: string
) {
  return {
    id: 'resp_synthetic',
    object: 'response',
    created_at: 0,
    status,
    incomplete_details: incompleteReason ? { reason: incompleteReason } : null,
    model: 'synthetic-openai-model',
    output: [
      { id: 'rs_synthetic', type: 'reasoning', summary: [] },
      { id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed', content },
    ],
  };
}

/** An OpenAI reply whose output text is `text` (the sample analysis as JSON by default). */
export function openaiText(text: string = SAMPLE_ANALYSIS_JSON): FakeRoute {
  return (url) => (isOpenAI(url) ? Response.json(openaiResponse([{ type: 'output_text', text, annotations: [] }])) : undefined);
}

export function openaiRefusal(): FakeRoute {
  return (url) => (isOpenAI(url) ? Response.json(openaiResponse([{ type: 'refusal', refusal: 'upstream detail that must not leak' }])) : undefined);
}

export function openaiIncomplete(reason: string): FakeRoute {
  return (url) =>
    isOpenAI(url)
      ? Response.json(openaiResponse([{ type: 'output_text', text: '{"textAndSigns": "cut off', annotations: [] }], 'incomplete', reason))
      : undefined;
}

export function openaiStatus(status: number, code: string | null = null): FakeRoute {
  return (url) =>
    isOpenAI(url)
      ? Response.json({ error: { message: 'upstream detail that must not leak', type: 'error', param: null, code } }, { status })
      : undefined;
}

/** The key a fake OpenAI request was sent with. */
export function openaiKeyOf(call: RecordedCall): string | null {
  const header = new Headers(call.init?.headers).get('authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

// ---------------------------------------------------------------------------
// Requests and stores.

export function jsonRequest(
  pathname: string,
  body: unknown,
  options: { method?: string; headers?: Record<string, string>; cookie?: string; origin?: string } = {}
): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json', ...options.headers });
  if (options.cookie) headers.set('cookie', options.cookie);
  return new NextRequest(new URL(pathname, options.origin ?? 'http://localhost:3000'), {
    method: options.method ?? 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export function getRequest(pathname: string, cookie?: string, method = 'GET'): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest(new URL(pathname, 'http://localhost:3000'), { method, headers });
}

/** The `name=value` pair from a response's Set-Cookie header, for use in a follow-up request. */
export function sessionCookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  return header.split(';')[0];
}

/** Creates a fresh scratch directory under the test temp root. */
export async function makeScratchDir(prefix = 'store-'): Promise<string> {
  const root = path.join(os.tmpdir(), `geolocation-guesser-tests-${process.pid}`);
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, prefix));
}

/** Writes a synthetic store and points the credential-store override at it for this test. */
export async function useSyntheticStore(data: Partial<StoreData> | string): Promise<string> {
  const dir = await makeScratchDir();
  const storePath = path.join(dir, 'credentials.json');
  const content =
    typeof data === 'string'
      ? data
      : JSON.stringify({ version: 1, credentials: {}, training: {}, ...data });
  await fs.writeFile(storePath, content, 'utf8');
  vi.stubEnv('GEOLOCATION_GUESSER_CREDENTIALS_FILE', storePath);
  return storePath;
}

/** Rewrites a store with new content and a later modification time so cached reads refresh. */
export async function rewriteStore(storePath: string, data: Partial<StoreData>): Promise<void> {
  await fs.writeFile(storePath, JSON.stringify({ version: 1, credentials: {}, training: {}, ...data }), 'utf8');
  const later = new Date(Date.now() + 5_000);
  await fs.utimes(storePath, later, later);
}

// ---------------------------------------------------------------------------
// Catalogs.

export function catalogModel(overrides: Partial<CatalogModel> & Pick<CatalogModel, 'id' | 'provider'>): CatalogModel {
  return {
    label: overrides.id,
    upstreamModel: `upstream-${overrides.id}`,
    workflows: ['scene', 'photo'],
    capabilities: { imageInput: true, structuredOutput: true },
    maxOutputTokens: 1024,
    default: false,
    ...overrides,
  };
}

/** Two enabled providers with several entries, including ones that must never be listed. */
export const TWO_PROVIDER_CATALOG: Catalog = {
  providers: [
    { id: 'gemini', label: 'Gemini', enabled: true, credentialField: 'geminiApiKey', participantKeys: true, streetViewImagery: true },
    { id: 'openai', label: 'OpenAI', enabled: true, credentialField: 'openaiApiKey', participantKeys: true, streetViewImagery: true },
  ],
  models: [
    catalogModel({ id: 'gem-default', provider: 'gemini', default: true }),
    catalogModel({ id: 'gem-photo', provider: 'gemini', workflows: ['photo'] }),
    catalogModel({ id: 'gem-text-only', provider: 'gemini', capabilities: { imageInput: false, structuredOutput: true } }),
    catalogModel({ id: 'oa-default', provider: 'openai', default: true, workflows: ['photo'] }),
  ],
  defaultSelection: { provider: 'gemini', model: 'gem-default' },
};
