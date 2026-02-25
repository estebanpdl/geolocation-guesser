import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

let loadPromise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (loadPromise) return loadPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    loadPromise = Promise.reject(
      new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set. Add it to .env.local')
    );
    return loadPromise;
  }

  setOptions({ key: apiKey, v: 'weekly' });

  loadPromise = Promise.all([
    importLibrary('maps'),
    importLibrary('streetView'),
  ]).then(() => {
    // Libraries are now available on the google.maps global
  });

  return loadPromise;
}
