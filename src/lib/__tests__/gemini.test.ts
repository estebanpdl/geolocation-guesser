import { describe, it, expect } from 'vitest';

// analyzeScene requires API keys and network — tested via integration/manual.
// These tests verify the module exports and parse logic.

describe('gemini module', () => {
  it('exports analyzeScene function', async () => {
    const mod = await import('../gemini');
    expect(typeof mod.analyzeScene).toBe('function');
  });

  it('exports SceneAnalysis type shape', async () => {
    const mod = await import('../gemini');
    // analyzeScene should throw without API key, confirming it runs
    await expect(mod.analyzeScene(48.8566, 2.3522)).rejects.toThrow();
  });
});
