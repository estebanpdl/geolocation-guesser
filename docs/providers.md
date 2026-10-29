# AI providers

How the server talks to Gemini and OpenAI, and where each choice comes from.
Sources were reviewed on 2026-10-29; recheck them before changing a model or SDK.

## SDKs

| Provider | Package | Version | Call |
|---|---|---|---|
| Gemini | `@google/genai` | 2.31.0 | `ai.models.generateContent()` |
| OpenAI | `openai` | 7.45.1 | `client.responses.create()` (Responses API) |

`@google/generative-ai` was removed: Google lists it as deprecated since 2025-11-30 and not actively
maintained, and recommends `@google/genai`
([libraries](https://ai.google.dev/gemini-api/docs/libraries), [migration guide](https://ai.google.dev/gemini-api/docs/migrate)).
`openai` 7.x requires Node.js 22 or later (its `engines` field); `@google/genai` 2.x needs Node.js 20 or later.
OpenAI recommends the Responses API for new projects ([openai-node](https://github.com/openai/openai-node)).

Both adapters live in `src/lib/server/providers/` and make **one request per analysis**:

- A new client is created for every call with the request's key, so keys are never shared or cached.
- Endpoints are fixed (`https://generativelanguage.googleapis.com/`, `https://api.openai.com/v1`). SDK
  environment settings that would change them are overridden: `GOOGLE_GEMINI_BASE_URL`,
  `GOOGLE_GENAI_USE_VERTEXAI`, `OPENAI_BASE_URL`. `OPENAI_ORG_ID` and `OPENAI_PROJECT_ID` are ignored as well,
  so a server's organization or project header is never sent with a participant's key.
- Retries are off. Gemini: `httpOptions.retryOptions.attempts = 1`. OpenAI: `maxRetries: 0`, because the SDK
  otherwise retries twice by default.
- Gemini's automatic continuation is off (`automaticContinuation: false`). It is on by default in
  `@google/genai` and would send a follow-up request when a response ends with `CONTINUATION`. That
  finish reason is reported as truncated output.
- Cancellation uses the request's deadline signal (`config.abortSignal` for Gemini, the `signal` request
  option for OpenAI). Aborting does not cancel work the provider has already started, which may still be billed.
- OpenAI responses are created with `store: false`. The API stores responses for later retrieval by default
  ([Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create)).

### Image and structured output

The same validated image bytes go to either provider:

- **Gemini:** an `inlineData` part (base64 plus MIME type) after the text prompt. Output uses
  `responseMimeType: 'application/json'` and `responseJsonSchema`, which accepts JSON Schema including
  `additionalProperties`.
- **OpenAI:** an `input_image` part with a `data:` URL and `detail: 'high'`. The app sends the original validated
  bytes without resizing; image processing and token billing depend on the selected model
  ([images and vision](https://developers.openai.com/api/docs/guides/images-vision)). Output uses
  `text.format: { type: 'json_schema', strict: true }`
  ([structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)).

Every result is still validated locally against the shared analysis contract. Refusals, truncation, empty
output and malformed JSON are errors, never partial analyses.

### Errors

| Upstream | Response |
|---|---|
| 429 (rate limit or quota/billing) | 429 `provider_quota` |
| 401, 403 | `provider_rejected`; reported as `participant_key_rejected` (401) when a participant's key was used |
| Gemini 400 with error reason `API_KEY_INVALID` | same as 401 |
| Other 4xx/5xx, network failure | 502 `provider_error` |
| Refusal: Gemini safety finish reasons (incl. `IMAGE_SAFETY`) or blocked prompt; OpenAI `refusal` part or `content_filter` | 422 `analysis_refused` |
| Gemini `MAX_TOKENS`/`CONTINUATION`; OpenAI `incomplete` with `max_output_tokens` | 502 `output_truncated` |

Provider messages are never returned or logged; only the upstream status is logged.

## Models

Catalog IDs are pinned model IDs, not moving aliases such as `gemini-flash-latest`. Prices are USD per
1M tokens (standard tier, input / output) from the providers' pricing pages on 2026-10-29.

| Catalog ID | Default | Image + structured output | Price | Notes |
|---|---|---|---|---|
| `gemini-3.5-flash-lite` | Gemini | Yes | $0.30 / $2.50 | Stable; recommended by Google for new projects; no shutdown date announced |
| `gemini-3.8-flash` | | Yes | $0.75 / $3.75 until 2026-12-31, then $1.50 / $7.50 | Stable |
| `gpt-6-luna` | OpenAI | Yes | $0.10 / $0.50 | Reasoning model; `reasoning.effort: 'low'` |
| `gpt-6.1-terra` | | Yes | $1.00 / $5.00 | Reasoning model; `reasoning.effort: 'low'` |

Sources: [Gemini models](https://ai.google.dev/gemini-api/docs/models),
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing),
[Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations),
[OpenAI models](https://developers.openai.com/api/docs/models),
[OpenAI pricing](https://developers.openai.com/api/docs/pricing).

`gemini-3.1-flash-lite` is cheaper ($0.25 / $1.50) but is scheduled to shut down on 2027-05-07, so it is not
listed. Output limits include thinking and reasoning tokens, which are billed as output on both providers.
Each entry allows 8,192 output tokens.

## Street View imagery

Each provider has a `streetViewImagery` flag in `src/lib/server/catalog.ts`. When it is false, the provider's
models are offered for photo analysis only, and scene requests are refused with 403
`street_view_not_permitted` before any Street View image is fetched.

Both providers are **on**, and a scene analysis sends the same starting Street View image either way.

- The [Street View Static API policies](https://developers.google.com/maps/documentation/streetview/policies)
  (updated 2026-10-28) generally prohibit storing or caching content and require Google Maps attribution. They
  defer to the governing [Terms of Service](https://cloud.google.com/maps-platform/terms) and
  [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms), which could not be
  retrieved by automated fetch.
- The project maintainer read those terms on 2026-10-29 and decided to allow Street View analysis with OpenAI
  and to keep it with Gemini. The basis: each image is fetched for one analysis of a publicly available
  location and sent to the selected provider in that request; the app does not store, cache or index it, and
  does not use it to train models. OpenAI requests also set `store: false`.
- This is the project's reading, not legal advice. Operators are responsible for their own compliance with the
  Google Maps Platform terms and each AI provider's terms. To stop sending Street View images to a provider,
  set its `streetViewImagery` flag to `false`.

## Not verified against the live APIs

All tests use fake transports. These behaviors come from documentation or SDK source and have not been
observed with real requests:

- the Gemini models accepting `responseJsonSchema` with `additionalProperties: false`;
- the exact error body Gemini returns for an invalid key;
- whether 8,192 output tokens leave enough room for each model's reasoning;
- OpenAI image token cost at `detail: 'high'` for these models.
