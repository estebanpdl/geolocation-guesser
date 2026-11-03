import { errorResponse, jsonResponse, newRequestId } from '@/lib/server/api-error';
import { loadServerConfig } from '@/lib/server/server-config';

/**
 * The Maps JavaScript browser key, resolved per request from the environment, the
 * project's .env files or the credential store. The key is public by design and
 * restricted by HTTP referrer; every page that shows a map hands it to the
 * browser, so it is served without a training session, like the game pages. It
 * is never logged. `browserKey` is null when no key is configured.
 */
export async function GET() {
  const requestId = newRequestId();
  try {
    const config = await loadServerConfig();
    return jsonResponse({ maps: { browserKey: config.credentials.mapsBrowserKey?.value ?? null } }, requestId);
  } catch (err) {
    return errorResponse(err, requestId, 'maps-config');
  }
}
