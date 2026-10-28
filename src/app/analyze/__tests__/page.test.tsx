import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import AnalyzePage from '../page';
import { resetCatalogCache } from '@/lib/api-client';
import { clearAllParticipantKeys } from '@/lib/participant-keys';
import { analysisRoute, catalogRoute, errorRoute, installBrowserFetch } from '@/test/browser';
import { SYNTHETIC, syntheticJpeg, toBase64 } from '@/test/fakes';

const KEY_LABEL = 'Your Gemini API key (optional)';

beforeEach(() => {
  clearAllParticipantKeys();
  resetCatalogCache();
});

async function renderWithPhoto({ trainingMode = 'off', upload = analysisRoute() } = {}) {
  const fetch = installBrowserFetch({
    '/api/analysis/catalog': catalogRoute(),
    '/api/ai-analysis-upload': upload,
    '/api/training/session': () => Response.json({ training: { mode: trainingMode, active: false, expiresAt: null } }),
  });
  const { container } = render(<AnalyzePage />);
  await screen.findByLabelText(KEY_LABEL);
  const file = new File([syntheticJpeg()], 'street.jpg', { type: 'image/jpeg' });
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
  await screen.findByRole('button', { name: 'Analyze Photo' });
  return fetch;
}

describe('AnalyzePage', () => {
  it('sends the photo with the participant key for the selected provider', async () => {
    const { posts } = await renderWithPhoto();
    fireEvent.change(screen.getByLabelText(KEY_LABEL), { target: { value: SYNTHETIC.PARTICIPANT_GEMINI_KEY_B } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Photo' }));

    await screen.findByRole('button', { name: 'Re-analyze Photo' });
    expect(posts('/api/ai-analysis-upload').map((c) => c.body)).toEqual([
      {
        image: toBase64(syntheticJpeg()),
        mimeType: 'image/jpeg',
        selection: { provider: 'gemini', model: 'gemini-flash' },
        participantKey: { provider: 'gemini', apiKey: SYNTHETIC.PARTICIPANT_GEMINI_KEY_B },
      },
    ]);
  });

  it('shows a rejected key once, with no second request', async () => {
    const { posts } = await renderWithPhoto({ upload: errorRoute(401, 'participant_key_rejected', 'Your key was rejected.') });
    fireEvent.change(screen.getByLabelText(KEY_LABEL), { target: { value: SYNTHETIC.PARTICIPANT_GEMINI_KEY_B } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Photo' }));

    await screen.findByText('Your key was rejected.');
    expect(posts('/api/ai-analysis-upload')).toHaveLength(1);
  });

  it('shows the header training link only while training is open', async () => {
    await renderWithPhoto({ trainingMode: 'open' });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Training access' }).getAttribute('href')).toBe('/training'));
  });

  it('hides the header training link while training is off', async () => {
    await renderWithPhoto({ trainingMode: 'off' });
    await act(async () => {});
    expect(screen.queryByRole('link', { name: 'Training access' })).toBeNull();
  });
});
