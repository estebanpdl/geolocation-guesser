'use client';

import { useEffect, useState } from 'react';
import type { AnalysisSelection, PublicCatalog, PublicCatalogProvider } from '@/lib/analysis/contract';
import { fetchCatalog } from '@/lib/api-client';

export interface AnalysisTarget {
  /** Null until the catalog loads, or when it cannot be loaded; requests then use the server default. */
  selection: AnalysisSelection | null;
  provider: PublicCatalogProvider | null;
}

/** The server's default selection and its provider entry from the public catalog. */
export function useAnalysisTarget(): AnalysisTarget {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);

  useEffect(() => {
    let active = true;
    fetchCatalog().then((result) => {
      if (active) setCatalog(result);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!catalog) return { selection: null, provider: null };
  const selection = catalog.defaultSelection;
  const provider = catalog.providers.find((p) => p.id === selection.provider) ?? null;
  return { selection: provider ? selection : null, provider };
}
