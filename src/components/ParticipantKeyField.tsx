'use client';

import { useId } from 'react';
import { PARTICIPANT_KEY_MAX_LENGTH, type PublicCatalogProvider } from '@/lib/analysis/contract';
import { clearParticipantKey, setParticipantKey, useParticipantKey } from '@/lib/participant-keys';

interface ParticipantKeyFieldProps {
  provider: PublicCatalogProvider;
  disabled?: boolean;
}

/**
 * Optional masked field for the participant's own key for one provider. The value
 * lives in page memory only and is sent only with this participant's analysis
 * requests; the status line says which credentials the next request will use.
 */
export default function ParticipantKeyField({ provider, disabled = false }: ParticipantKeyFieldProps) {
  const inputId = useId();
  const value = useParticipantKey(provider.id);
  const hasKey = value.trim().length > 0;

  if (!provider.participantKeys) return null;

  const status = hasKey
    ? `Your ${provider.label} key will be used for your analyses on this page. It is not saved and is forgotten when you reload.`
    : provider.operatorCredentials
      ? `Using the server's ${provider.label} credentials.`
      : `The server has no ${provider.label} credentials. Enter your own key to analyze.`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-[10px] text-tactical-muted uppercase tracking-wider">
        Your {provider.label} API key (optional)
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="password"
          value={value}
          onChange={(e) => setParticipantKey(provider.id, e.target.value)}
          maxLength={PARTICIPANT_KEY_MAX_LENGTH}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder="Leave empty to use the server's credentials"
          className="input-field flex-1 min-w-0 text-xs"
        />
        {hasKey && (
          <button
            type="button"
            onClick={() => clearParticipantKey(provider.id)}
            disabled={disabled}
            className="text-xs px-2 rounded border border-tactical-border text-tactical-muted hover:text-slate-300"
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-[10px] text-tactical-muted" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
