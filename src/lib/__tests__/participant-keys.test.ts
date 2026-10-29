import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllParticipantKeys,
  clearParticipantKey,
  getParticipantKey,
  participantKeyField,
  setParticipantKey,
} from '../participant-keys';
import { SYNTHETIC } from '@/test/fakes';
import { persistedBrowserState } from '@/test/browser';

beforeEach(() => clearAllParticipantKeys());

describe('participant key memory', () => {
  it('keeps keys per provider, so one provider never receives another provider\'s key', () => {
    setParticipantKey('gemini', SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
    expect(participantKeyField('gemini')).toEqual({ provider: 'gemini', apiKey: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A });
    expect(participantKeyField('openai')).toBeUndefined();

    setParticipantKey('openai', SYNTHETIC.PARTICIPANT_OPENAI_KEY);
    clearParticipantKey('gemini');
    expect(participantKeyField('gemini')).toBeUndefined();
    expect(participantKeyField('openai')?.apiKey).toBe(SYNTHETIC.PARTICIPANT_OPENAI_KEY);
  });

  it('treats a blank value as no key', () => {
    setParticipantKey('gemini', '   ');
    expect(participantKeyField('gemini')).toBeUndefined();
    setParticipantKey('gemini', '');
    expect(getParticipantKey('gemini')).toBe('');
  });

  it('writes nothing to browser storage, cookies or the URL', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const before = persistedBrowserState();
    setParticipantKey('gemini', SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
    expect(setItem).not.toHaveBeenCalled();
    expect(persistedBrowserState()).toBe(before);
    expect(persistedBrowserState()).not.toContain(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
  });
});
