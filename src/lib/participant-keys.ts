'use client';

/**
 * Participant-supplied provider keys, held in this page's JavaScript memory only.
 * Nothing is written to localStorage, sessionStorage, cookies or the URL, so a
 * reload or a closed tab forgets every key. Keys are stored per provider, so a
 * key entered for one provider is never sent to another.
 */
import { useSyncExternalStore } from 'react';
import type { ParticipantKeyInput, ProviderId } from '@/lib/analysis/contract';

const keys = new Map<ProviderId, string>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  for (const listener of listeners) listener();
}

export function getParticipantKey(provider: ProviderId): string {
  return keys.get(provider) ?? '';
}

/** A blank value removes the key, which restores the server credentials for that provider. */
export function setParticipantKey(provider: ProviderId, value: string): void {
  if (value) keys.set(provider, value);
  else keys.delete(provider);
  notify();
}

export function clearParticipantKey(provider: ProviderId): void {
  if (!keys.delete(provider)) return;
  notify();
}

export function clearAllParticipantKeys(): void {
  keys.clear();
  notify();
}

/** The request field for a provider, or undefined when the server credentials should be used. */
export function participantKeyField(provider: ProviderId): ParticipantKeyInput | undefined {
  const apiKey = getParticipantKey(provider).trim();
  return apiKey ? { provider, apiKey } : undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current key for a provider, re-rendering when it changes. */
export function useParticipantKey(provider: ProviderId | null): string {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return provider ? getParticipantKey(provider) : '';
}
