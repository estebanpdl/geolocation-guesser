'use client';

import { useState, useEffect, useCallback } from 'react';
import type { GameSession } from '@/lib/types';
import { getSessions, deleteSession as removeSession } from '@/lib/session-storage';

export function useSessionHistory() {
  const [sessions, setSessions] = useState<GameSession[]>([]);

  const refresh = useCallback(() => {
    setSessions(getSessions());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const deleteSession = useCallback(
    (id: string) => {
      removeSession(id);
      refresh();
    },
    [refresh]
  );

  return { sessions, refresh, deleteSession };
}
