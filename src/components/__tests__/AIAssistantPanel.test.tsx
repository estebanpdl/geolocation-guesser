import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AIAssistantPanel from '../AIAssistantPanel';
import ParticipantKeyField from '../ParticipantKeyField';
import { resetCatalogCache } from '@/lib/api-client';
import { clearAllParticipantKeys, setParticipantKey } from '@/lib/participant-keys';
import {
  analysisRoute,
  catalogRoute,
  errorRoute,
  installBrowserFetch,
  persistedBrowserState,
  publicCatalogFixture,
} from '@/test/browser';
import { SYNTHETIC } from '@/test/fakes';

const LOCATION = { lat: 48.8566, lng: 2.3522 };
const KEY_LABEL = 'Your Gemini API key (optional)';

beforeEach(() => {
  clearAllParticipantKeys();
  resetCatalogCache();
});

function keyInput(): HTMLInputElement {
  return screen.getByLabelText(KEY_LABEL) as HTMLInputElement;
}

async function renderPanel() {
  render(<AIAssistantPanel location={LOCATION} />);
  await screen.findByLabelText(KEY_LABEL);
}

async function analyzeAndReset() {
  fireEvent.click(screen.getByRole('button', { name: 'Analyze Scene' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Clear analysis' }));
}

describe('ParticipantKeyField', () => {
  it('is a masked, non-autocompleting field that states which credentials apply', () => {
    const provider = publicCatalogFixture().providers[0];
    render(<ParticipantKeyField provider={provider} />);
    expect(keyInput().type).toBe('password');
    expect(keyInput().getAttribute('autocomplete')).toBe('off');
    expect(screen.getByText("Using the server's Gemini credentials.")).toBeTruthy();

    fireEvent.change(keyInput(), { target: { value: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A } });
    expect(screen.getByText(/Your Gemini key will be used for your analyses on this page/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(keyInput().value).toBe('');
    expect(screen.getByText("Using the server's Gemini credentials.")).toBeTruthy();
  });

  it('asks for a key when the server has no credentials for the provider', () => {
    render(<ParticipantKeyField provider={publicCatalogFixture(false).providers[0]} />);
    expect(screen.getByText('The server has no Gemini credentials. Enter your own key to analyze.')).toBeTruthy();
  });
});

describe('AIAssistantPanel', () => {
  it('sends the selection, adds the key only while one is set, and clearing restores server credentials', async () => {
    const { posts } = installBrowserFetch({ '/api/analysis/catalog': catalogRoute(), '/api/ai-analysis': analysisRoute() });
    await renderPanel();

    await analyzeAndReset();
    fireEvent.change(keyInput(), { target: { value: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A } });
    await analyzeAndReset();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await analyzeAndReset();

    const bodies = posts('/api/ai-analysis').map((c) => c.body);
    expect(bodies).toEqual([
      { ...LOCATION, heading: 0, pitch: 0, selection: { provider: 'gemini', model: 'gemini-flash' } },
      {
        ...LOCATION,
        heading: 0,
        pitch: 0,
        selection: { provider: 'gemini', model: 'gemini-flash' },
        participantKey: { provider: 'gemini', apiKey: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A },
      },
      { ...LOCATION, heading: 0, pitch: 0, selection: { provider: 'gemini', model: 'gemini-flash' } },
    ]);
  });

  it('keeps the key in page memory only', async () => {
    installBrowserFetch({ '/api/analysis/catalog': catalogRoute(), '/api/ai-analysis': analysisRoute() });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const before = persistedBrowserState();
    await renderPanel();

    fireEvent.change(keyInput(), { target: { value: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A } });
    await analyzeAndReset();

    expect(setItem).not.toHaveBeenCalled();
    expect(persistedBrowserState()).toBe(before);
  });

  it('shows a rejected key as an error without retrying on server credentials', async () => {
    const { posts } = installBrowserFetch({
      '/api/analysis/catalog': catalogRoute(),
      '/api/ai-analysis': errorRoute(401, 'participant_key_rejected', 'The AI provider rejected the request made with your API key.'),
    });
    await renderPanel();
    fireEvent.change(keyInput(), { target: { value: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Scene' }));

    await screen.findByText('The AI provider rejected the request made with your API key.');
    expect(posts('/api/ai-analysis')).toHaveLength(1);
    expect(keyInput().value).toBe(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
    expect(screen.queryByText(/training access code/)).toBeNull();
  });

  it('still offers the training link when a session is required', async () => {
    installBrowserFetch({
      '/api/analysis/catalog': catalogRoute(),
      '/api/ai-analysis': errorRoute(401, 'training_session_required', 'Enter the training access code to use AI analysis.'),
    });
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Scene' }));
    expect((await screen.findByText(/Enter the training access code \(opens a new tab\)/)).closest('a')?.getAttribute('href')).toBe('/training');
  });

  it('uses the server default without a key field when the catalog is unavailable', async () => {
    const { posts } = installBrowserFetch({
      '/api/analysis/catalog': errorRoute(500, 'internal_error'),
      '/api/ai-analysis': analysisRoute(),
    });
    setParticipantKey('gemini', SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
    render(<AIAssistantPanel location={LOCATION} />);
    await act(async () => {});

    expect(screen.queryByLabelText(KEY_LABEL)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Scene' }));
    await waitFor(() => expect(posts('/api/ai-analysis')).toHaveLength(1));
    expect(posts('/api/ai-analysis')[0].body).toEqual({ ...LOCATION, heading: 0, pitch: 0 });
  });

  it('rejects a success response that does not match the contract', async () => {
    installBrowserFetch({
      '/api/analysis/catalog': catalogRoute(),
      '/api/ai-analysis': () => Response.json({ analysis: { textAndSigns: 'only one field' }, requestId: 'x' }),
    });
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Scene' }));
    expect(await screen.findByText('The analysis response was not in the expected format.')).toBeTruthy();
  });
});
