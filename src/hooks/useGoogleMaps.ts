'use client';

import { useState, useEffect } from 'react';
import { loadGoogleMaps } from '@/lib/google-maps';

interface UseGoogleMapsResult {
  isLoaded: boolean;
  error: string | null;
}

export function useGoogleMaps(): UseGoogleMapsResult {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then(() => {
        if (!cancelled) setIsLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load Google Maps');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { isLoaded, error };
}
