import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

/** Serves the browser key at request time, so it can come from the server's credential store. */
const MAPS_CONFIG_ENDPOINT = '/api/maps/config';

export const MAPS_KEY_MISSING_MESSAGE =
  'The Google Maps browser key is not configured. Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in the server ' +
  'environment or .env.local and restart the server, or save it with: npm run auth -- set maps-browser';

export const MAPS_CONFIG_UNAVAILABLE_MESSAGE = 'The Google Maps configuration could not be loaded from the server.';

let loadPromise: Promise<void> | null = null;

async function fetchBrowserKey(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(MAPS_CONFIG_ENDPOINT, { cache: 'no-store' });
  } catch {
    throw new Error(MAPS_CONFIG_UNAVAILABLE_MESSAGE);
  }
  if (!res.ok) throw new Error(MAPS_CONFIG_UNAVAILABLE_MESSAGE);

  const data = await res.json().catch(() => null);
  const key: unknown = data?.maps?.browserKey;
  if (key === null) throw new Error(MAPS_KEY_MISSING_MESSAGE);
  if (typeof key !== 'string' || !key) throw new Error(MAPS_CONFIG_UNAVAILABLE_MESSAGE);
  return key;
}

/**
 * Loads the Maps JavaScript API once per page. If the key cannot be obtained, the
 * failure is not kept, so a later map retries (for example after the operator
 * saves the key with `npm run auth`).
 */
export function loadGoogleMaps(): Promise<void> {
  if (loadPromise) return loadPromise;

  const attempt: Promise<void> = fetchBrowserKey().then(
    async (apiKey) => {
      setOptions({ key: apiKey, v: 'weekly' });
      await Promise.all([importLibrary('maps'), importLibrary('streetView')]);
      // Libraries are now available on the google.maps global
    },
    (err: unknown) => {
      if (loadPromise === attempt) loadPromise = null;
      throw err;
    }
  );
  loadPromise = attempt;
  return attempt;
}

/** Forgets the loaded state; for tests. */
export function resetGoogleMapsLoader(): void {
  loadPromise = null;
}
