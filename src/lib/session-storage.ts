import type { GameSession } from './types';

const STORAGE_KEY = 'geoint_sessions';
const MAX_SESSIONS = 50;

export function saveSession(session: GameSession): void {
  try {
    const sessions = getSessions();
    // Replace if same id exists, otherwise prepend
    const existingIdx = sessions.findIndex((s) => s.id === session.id);
    if (existingIdx >= 0) {
      sessions[existingIdx] = session;
    } else {
      sessions.unshift(session);
    }
    // Trim to max
    const trimmed = sessions.slice(0, MAX_SESSIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full — remove oldest sessions and retry
    try {
      const sessions = getSessions();
      const trimmed = [session, ...sessions.slice(0, MAX_SESSIONS / 2)];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Give up
    }
  }
}

export function getSessions(): GameSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function getSession(id: string): GameSession | null {
  const sessions = getSessions();
  return sessions.find((s) => s.id === id) ?? null;
}

export function deleteSession(id: string): void {
  try {
    const sessions = getSessions().filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // ignore
  }
}
