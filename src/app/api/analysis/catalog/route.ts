import { errorResponse, jsonResponse, newRequestId } from '@/lib/server/api-error';
import { publicCatalog } from '@/lib/server/catalog';
import { loadServerConfig } from '@/lib/server/server-config';

/** The selectable providers and models, and which credentials each can use. Contains no credential values. */
export async function GET() {
  const requestId = newRequestId();
  try {
    const config = await loadServerConfig();
    return jsonResponse({ catalog: publicCatalog(config) }, requestId);
  } catch (err) {
    return errorResponse(err, requestId, 'analysis-catalog');
  }
}
