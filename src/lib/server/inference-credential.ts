/**
 * Chooses the inference key for one request: the participant's own key for the
 * selected provider when supplied, otherwise the operator's configured key.
 *
 * A participant key is held only in the returned object for the life of the
 * request. It is never stored, cached, logged or included in an error message.
 */
import { isWellFormedParticipantKey, type CredentialSource } from '@/lib/analysis/contract';
import { ApiError } from './api-error';
import type { CatalogProvider } from './catalog';
import type { ServerConfig } from './server-config';

export interface InferenceCredential {
  apiKey: string;
  source: CredentialSource;
}

function invalidKey(): ApiError {
  return new ApiError(400, 'invalid_participant_key', 'The API key entered is not in a valid format.');
}

/**
 * `participantKey` is the request's `{ provider, apiKey }` field. Omitted or
 * blank means operator credentials; anything else must be a well-formed key for
 * the selected provider. A supplied key never falls back to operator credentials.
 */
export function resolveInferenceCredential(
  participantKey: unknown,
  provider: CatalogProvider,
  config: ServerConfig
): InferenceCredential {
  if (participantKey !== undefined) {
    if (participantKey === null || typeof participantKey !== 'object' || Array.isArray(participantKey)) throw invalidKey();
    const { provider: keyProvider, apiKey } = participantKey as Record<string, unknown>;
    if (typeof apiKey !== 'string') throw invalidKey();
    const key = apiKey.trim();
    if (key) {
      if (keyProvider !== provider.id) {
        throw new ApiError(400, 'participant_key_mismatch', `The API key entered is not for ${provider.label}.`);
      }
      if (!provider.participantKeys) {
        throw new ApiError(400, 'participant_keys_unsupported', `${provider.label} does not accept participant keys on this server.`);
      }
      if (!isWellFormedParticipantKey(key)) throw invalidKey();
      return { apiKey: key, source: 'participant' };
    }
  }

  const operatorKey = config.credentials[provider.credentialField]?.value;
  if (!operatorKey) {
    throw new ApiError(
      503,
      'analysis_unconfigured',
      provider.participantKeys
        ? `${provider.label} is not configured on this server. Enter your own ${provider.label} API key to use it.`
        : 'AI analysis is not configured on this server.'
    );
  }
  return { apiKey: operatorKey, source: 'operator' };
}

/** A provider rejection of a participant's key is reported as theirs to fix, not as a server fault. */
export function attributeCredentialError(err: unknown, credential: InferenceCredential): unknown {
  if (credential.source === 'participant' && err instanceof ApiError && err.code === 'provider_rejected') {
    return new ApiError(
      401,
      'participant_key_rejected',
      'The AI provider rejected the request made with your API key. Check the key, or clear it to use the server credentials.',
      { upstreamStatus: err.upstreamStatus }
    );
  }
  return err;
}
