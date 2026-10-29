import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TrainingNavLink from '../TrainingNavLink';
import { errorRoute, installBrowserFetch } from '@/test/browser';

function trainingStatus(mode: string) {
  return () => Response.json({ training: { mode, active: false, expiresAt: null }, requestId: 'status' });
}

async function renderLink(props: Parameters<typeof TrainingNavLink>[0] = {}) {
  render(<TrainingNavLink {...props} />);
  await act(async () => {});
}

describe('TrainingNavLink', () => {
  it('links to the training page while training is open', async () => {
    const { calls } = installBrowserFetch({ '/api/training/session': trainingStatus('open') });
    await renderLink();
    const link = screen.getByRole('link', { name: 'Training access' });
    expect(link.getAttribute('href')).toBe('/training');
    expect(link.getAttribute('target')).toBeNull();
    expect(calls).toEqual([{ path: '/api/training/session', method: 'GET', body: null }]);
  });

  it('can open in a new tab to keep the current page', async () => {
    installBrowserFetch({ '/api/training/session': trainingStatus('open') });
    await renderLink({ newTab: true });
    expect(screen.getByRole('link', { name: 'Training access' }).getAttribute('target')).toBe('_blank');
  });

  it.each(['off', 'closed', 'unavailable', 'something-else'])('is hidden when the mode is %s', async (mode) => {
    installBrowserFetch({ '/api/training/session': trainingStatus(mode) });
    await renderLink();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('is hidden when the status cannot be read', async () => {
    installBrowserFetch({ '/api/training/session': errorRoute(500, 'internal_error') });
    await renderLink();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
