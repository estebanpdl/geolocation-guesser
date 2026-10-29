# Geolocation Guesser

A web app for practicing OSINT geolocation. Players explore a Google Street View panorama, place a guess on a
map and score by distance. An optional AI analysis describes the visual clues in the scene, and a separate page
analyzes photos you upload.

It runs locally for one person, or on a server you control for a group training session that uses your server's
credentials behind an access code.

> [!WARNING]
> **Before you host a public training session, read [Costs and public hosting](#costs-and-public-hosting).**
>
> - Participants spend **your stored credentials** for every AI analysis, unless they enter their own key for the
>   selected provider.
> - The app has **no usage caps**: no per-session, per-participant or total limits on analyses. The training access
>   code controls who can analyze, not how much.
> - If you want a spend limit, set it with each provider, on your own keys: budgets, quotas or billing alerts in your
>   Google Cloud and OpenAI accounts.
> - **Never leave a reachable host in `off` mode.** In `off`, anyone who can reach the server can run AI analyses on
>   your keys without a code. Use `closed` when no session is running.
> - Google Maps calls cost money even with AI turned off. Anyone who can reach the site can play, and every game
>   loads maps and panoramas on your Maps key.

## Contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Setup](#setup)
- [Running](#running)
- [Server credentials: `npm run auth`](#server-credentials-npm-run-auth)
- [AI analysis](#ai-analysis)
- [Participant keys](#participant-keys)
- [Training sessions](#training-sessions)
- [Costs and public hosting](#costs-and-public-hosting)
- [Browser history](#browser-history)
- [Development](#development)
- [Known limitations](#known-limitations)

## What it does

**Game** (`/`, then `/game`). Enter an alias and choose 1–10 rounds (default 5). Each round:

1. A Street View panorama opens at a location drawn from a built-in pool of about 18,500 coordinates. New
   locations are at least 50 km from the ones already used in the session.
2. You can move and look around freely.
3. Optionally, **Analyze Scene** asks the AI for clues; the round is then marked as AI-assisted.
4. You place a guess on the map and confirm it.
5. The score is up to 5,000 points and decays exponentially with the great-circle distance. Accuracy is rated
   Excellent (≤ 50 km), Good (≤ 300 km), Fair (≤ 1,500 km) or Poor.

**Photo analysis** (`/analyze`). Upload a JPEG, PNG or WebP photo (at most 10 MB, 12,000 px per side and
50 megapixels) and get the same structured analysis. Nothing is scored.

**History** (`/history`). Completed sessions are listed with their rounds, guesses and scores. They are stored only
in your browser.

There is no form for writing down your own reasoning.

### AI output is a hypothesis, not evidence

The analysis has seven sections:

- text and signs;
- landmarks and buildings;
- road and infrastructure;
- vehicles and plates;
- vegetation and terrain;
- cultural indicators;
- an overall assessment with a confidence level.

It is a model's reading of one image. It can be wrong, overconfident or invented, and its confidence level is the
model's own. Treat it as a lead to verify against the imagery and other sources. It never establishes where an
image was taken.

## Requirements

- **A Node.js 22 release with current security fixes.**
  The `openai` SDK requires Node 22 and `npm run auth` uses Node's built-in TypeScript type stripping.
  Developed with Node 22.15.0 and npm 11; that development version is not a security recommendation.
- **A Google Maps Platform project** with billing enabled and these APIs:
  - Maps JavaScript API, for the browser map and panoramas;
  - Street View Static API, for scene analysis.
- **For AI analysis, optional:** a Gemini API key (Google AI Studio), an OpenAI API key, or both. Participants can
  also bring their own key.

## Setup

Install the exact locked dependencies:

```sh
npm ci
```

Copy the configuration template. `.env.local` is ignored by Git.

```powershell
# PowerShell
Copy-Item .env.example .env.local
```

```sh
# macOS / Linux
cp .env.example .env.local
```

Then fill in the values you need. Placeholder values from the template count as unset.

| Variable | Where it is used | Notes |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser | **Public by design.** It is embedded in the page at build time. |
| `GOOGLE_MAPS_API_KEY` | Server | Street View Static images for scene analysis. |
| `GOOGLE_GENERATIVE_AI_KEY` | Server | Gemini API key. |
| `OPENAI_API_KEY` | Server | OpenAI API key. |
| `TRAINING_MODE`, `TRAINING_ACCESS_CODE`, `TRAINING_SESSION_TTL_MINUTES` | Server | See [Training sessions](#training-sessions). |
| `GEOLOCATION_GUESSER_CREDENTIALS_FILE` | Server | Optional absolute path for the credential store. |

### Use separate, restricted keys

Use two Google keys:

- **The browser key** (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) ships to every visitor. In Google Cloud, restrict it to
  your site's HTTP referrers and to the Maps JavaScript API only.
- **The server key** (`GOOGLE_MAPS_API_KEY`) never reaches the browser. Restrict it to the Street View Static API
  and, if your host has a fixed address, to that IP. If it is unset, the server falls back to the browser key. That
  works, but it means a key exposed in every page also has Static API access.

The Gemini and OpenAI keys are server-only. They are never sent to the browser, included in responses or written to
logs.

Instead of putting server keys in `.env.local`, you can save them outside the repository with
[`npm run auth`](#server-credentials-npm-run-auth). The browser key must stay in the environment, because it is
needed at build time.

## Running

| Command | What it does |
|---|---|
| `npm run dev` | Development server at <http://localhost:3000>. |
| `npm run build` | Production build. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` first: it is embedded at this step. |
| `npm run start` | Serves the production build (`next start`, port 3000 by default; `npm run start -- -p 8080` to change it). |

Settings saved with `npm run auth` reach a running server on its next request. Changes to `.env*` files take effect
when the server restarts. Neither needs a rebuild, except the browser key.

## Server credentials: `npm run auth`

`npm run auth` manages the server's own credentials and training settings. Run it as the user account that runs
the server, in the project directory.

```sh
npm run auth                          # same as: npm run auth -- status
npm run auth -- status                # which settings are configured, and where from (values are never shown)
npm run auth -- path                  # where the credential store is
npm run auth -- set gemini            # save a key at a masked prompt: gemini | openai | maps-server
npm run auth -- remove openai         # delete a saved key
npm run auth -- training open         # require the access code for AI analysis
npm run auth -- training close        # block AI analysis for everyone
npm run auth -- training off          # local use: no access code
npm run auth -- training rotate       # generate a new access code and show it once
npm run auth -- training code         # enter your own access code at a masked prompt
npm run auth -- help
```

`maps-server` is the Street View Static server key.

### Where it saves settings

The store is `~/.geolocation-guesser/credentials.json` in the server account's home directory. On Windows that is
`%USERPROFILE%\.geolocation-guesser\credentials.json`. To use another file, set `GEOLOCATION_GUESSER_CREDENTIALS_FILE`
to an absolute path.

- Writes are atomic.
- On macOS and Linux, the file is created owner-only (`0600`, directory `0700`), and `status` warns if other users
  can read it. On Windows it inherits the permissions of your user profile.
- The keys are stored as **plain text**, not encrypted. Protect the server account accordingly.
- If the store cannot be read or parsed, AI analysis is blocked until it is fixed.

### Which value wins

For each setting, the order is:

1. a nonempty variable in the server's environment or the project's `.env*` files (in Next.js's order:
   `.env.production.local` or `.env.development.local`, then `.env.local`, then `.env.production` or
   `.env.development`, then `.env`);
2. the saved value;
3. unset.

**One exception:** a saved `closed` training mode always wins, even over `TRAINING_MODE` in the environment. It works
as the off switch.

`auth` evaluates the same files the server reads, for both `next start` and `next dev`:

- It tells you when an environment value overrides what you just saved.
- It refuses training changes that the environment would override, so a reported change is a change the server
  will actually apply.
- It cannot see variables set only in the server's process environment (for example by a service manager). `status`
  says so.

Use literal values for these settings in `.env*` files. Next.js expands `$VARIABLE` references, but `auth` reads
them literally, so its status and override checks can differ from the server when expansion is used.

Saved changes reach a running server on its next request; no restart is needed.

## AI analysis

### Providers and models

The server keeps a fixed catalog. Requests choose entries by catalog ID, and anything not in the catalog is rejected.

| Catalog ID | Provider | Default | Price per 1M tokens (input / output) |
|---|---|---|---|
| `gemini-3.5-flash-lite` | Gemini | **Yes** (app-wide and Gemini) | $0.30 / $2.50 |
| `gemini-3.8-flash` | Gemini | | $0.75 / $3.75 until 2026-12-31, then $1.50 / $7.50 |
| `gpt-6-luna` | OpenAI | OpenAI | $0.10 / $0.50 |
| `gpt-6.1-terra` | OpenAI | | $1.00 / $5.00 |

Prices are the providers' standard-tier list prices as of 2026-10-29; check the providers' pricing pages for current
rates. Output includes the models' thinking or reasoning tokens. Each analysis allows up to 8,192 output tokens.
[`docs/providers.md`](docs/providers.md) records the sources, SDK settings and error mapping.

**What the pages use today.** The game and photo pages always send the catalog default, Gemini 3.5 Flash-Lite. The
API routes (`POST /api/ai-analysis` and `POST /api/ai-analysis-upload`) accept any listed entry in a
`selection: { provider, model }` field, and `GET /api/analysis/catalog` lists them. To change what the pages use,
edit `defaultSelection` in `src/lib/server/catalog.ts`.

### One call per analysis

- Analysis runs only when someone clicks **Analyze Scene**, **Analyze Photo**, **Re-analyze Photo** or **Retry**.
  Nothing runs in the background.
- Each accepted analysis makes **one** request to the selected provider: one image plus one prompt. A scene analysis
  also makes one Street View Static request for the image.
- Automatic retries are off in both SDKs. There is no fallback to another model, provider or key, and no follow-up
  "repair" request.
- Every click, including **Retry**, is a new, separately billed request.
- After the request body has been read and validated, scene image retrieval plus inference have a shared
  60-second deadline (inference only for photos). This does not time-limit the incoming upload. If a request
  is cancelled after the provider has started work, the provider may still bill for it.

### What is sent where

- **Scene analysis:** the server fetches one Street View Static image for the round's coordinates and sends it, with
  the prompt, to the selected provider.
- **Photo analysis:** the server checks the photo's byte size, signature and header dimensions, then sends the
  original bytes with the prompt to the selected provider. It does not fully decode or re-encode the file;
  embedded metadata is not stripped, and the provider may still reject a damaged image.

The app does not store, cache or log images or analyses on the server; results are only shown in the browser. OpenAI
requests are sent with `store: false`. How each provider retains or uses request data depends on its terms for your
account and tier.

Street View imagery is sent to both providers. **You are responsible for your own compliance** with the
[Google Maps Platform terms](https://cloud.google.com/maps-platform/terms) (including the Street View Static API
policies) and with each AI provider's terms. `docs/providers.md` describes the project's reading of those terms.
To stop sending Street View images to a provider, set its `streetViewImagery` flag to `false` in
`src/lib/server/catalog.ts`. That provider then stays available for photos only.

### When analysis fails

The panel shows a short message, never a partial or placeholder analysis. Common causes:

| Message about | Meaning |
|---|---|
| No credentials (503 `analysis_unconfigured`) | The server has no key for the provider and the participant entered none. |
| Training access (401 / 403) | A training session is needed, or training is closed. See [Training sessions](#training-sessions). |
| Key rejected (401 `participant_key_rejected`) | The participant's own key was refused. The server key is not tried instead. |
| Quota (429 `provider_quota`) | The provider's rate limit, quota or billing limit was reached. |
| No imagery (422 `no_imagery`) | Street View has no image at that location. |
| Refused, truncated or invalid output (422 / 502) | The model declined, ran out of output tokens or returned something that is not a complete analysis. |
| Deadline (504) | The analysis took longer than 60 seconds. |

Failed requests are logged with fixed fields only: the route, a request ID, the status and error code, and the
upstream status or error type. Provider messages, keys, codes and images are never logged.

## Participant keys

Above the analyze button, a participant can enter their own API key for the provider in use. It is optional.

- It is kept **only in that browser tab's memory**. It is not saved to browser storage and is forgotten on reload;
  **Clear** removes it at once.
- It is sent only with that participant's analysis requests, and only to the provider it belongs to.
- The server uses it for that one request, then discards it. It is never stored, logged or included in a response,
  and never reused for another request or provider.
- While a key is entered, that participant's analyses are billed to them. Without one, the server's credentials
  are used, and the field says which applies.
- If the provider rejects the key, the analysis fails. The server's key is not tried instead.
- Training access still applies: a participant key does not bypass the access code.
- A participant key covers only the AI provider. Street View Static images and the browser map still use your
  Google Maps keys.

## Training sessions

Training access protects the two AI analysis routes. It does not gate the game itself (see
[Costs and public hosting](#costs-and-public-hosting)).

| Mode | Behavior |
|---|---|
| `off` (default) | Local use. AI analysis needs no code, so only use it on a server others cannot reach. |
| `open` | AI analysis requires a session, started by entering the access code at `/training`. |
| `closed` | AI analysis is refused for everyone, including participants with their own key. |

How it works:

- **Access code:** 8–128 characters, ignoring case, spaces and hyphens. `npm run auth -- training rotate` generates
  one and shows it once. You can also set your own with `training code` or `TRAINING_ACCESS_CODE`.
- **Fails closed:** if training is `open` but no usable code is configured, AI analysis is blocked rather than opened.
- **Sessions:** a correct code starts a server-checked session, held in a `gg_training_session` cookie (HttpOnly,
  SameSite=Strict, Secure over HTTPS). Sessions expire after `TRAINING_SESSION_TTL_MINUTES`: 180 by default,
  5 to 1,440 allowed.
- **Code attempts are bounded:** 5 wrong codes per client address in 10 minutes, and 30 wrong codes across all
  clients per minute. Further attempts get 429 until the window passes. The client address comes from the
  `X-Forwarded-For` header, which a client can forge, so the host-wide bound is the one that holds. Without a proxy
  that sets it, all clients share one address and one 5-attempt allowance.
- **Rotating** the code ends every existing session. **Closing** blocks new analyses immediately. Both apply to a
  running server on its next request.
- The `/training` link appears in the page headers while training is open, and after an analysis is refused for lack
  of a session.

### Running a public session

1. Configure server keys (`npm run auth -- set gemini`, and so on) and build with your restricted browser key.
2. `npm run auth -- training rotate`, and note the code.
3. `npm run auth -- training open`.
4. Run **one** `npm run start` process behind an HTTPS reverse proxy. The proxy should set `X-Forwarded-Proto` and
   overwrite `X-Forwarded-For`.
5. Share the site address and the code with participants.
6. When you are done: `npm run auth -- training close`. Switch to `training off` only once the server can no longer
   be reached by others (for example, back on `localhost` only).

**Single process only.** Sessions and attempt counters live in that server process's memory:

- Restarting the server ends every session, and participants enter the code again.
- Running several instances (a cluster, several containers or serverless functions) is not supported. Sessions
  and attempt limits would not be shared.

## Costs and public hosting

This repository is public. If you host it for others, this is what that means:

- **AI analysis is billed to you by default.** Every participant without their own key spends your stored Gemini or
  OpenAI credentials. With an entered key, the AI call is billed to the participant.
- **There are no usage caps.** The app does not limit how many analyses a session, participant or host can run, and
  shows no "limit reached" state. One participant can run many analyses per round, and several participants can run
  them at once.
- **Spend limits are set with the providers.** Use budgets, quotas and billing alerts in your Google Cloud account
  (Maps and Gemini) and your OpenAI account. The app cannot enforce them for you.
- **Never leave a reachable host in `off` mode.** `off` turns training access off entirely: anyone who can reach the
  server can run AI analyses on your stored keys, without a code. Keep a reachable host in `open` during a session
  and `closed` otherwise.
- **Google Maps costs money without AI.** Every game loads the Maps JavaScript API, a Street View panorama per round
  and the guess map on your browser key. Each scene analysis adds a Street View Static request on your server key.
  The training access code does not protect the game pages, so anyone who can reach the site can generate Maps
  usage.
- **To limit exposure:**
  - restrict both Google keys as described in [Setup](#use-separate-restricted-keys);
  - keep the host private or behind your own access control when no session is running;
  - close training when a session ends;
  - rotate the code if it leaks.

## Browser history

- Completed sessions are saved in the browser's `localStorage` under `geoint_sessions`. The newest 50 are kept.
- Delete a session from `/history`. Clearing the site's data in the browser removes them all.
- History is never sent to the server.
- Older saved sessions remain readable.

## Development

```sh
npm run typecheck     # tsc --noEmit
npm test              # all tests (Vitest)
npm test -- src/lib/server/__tests__/catalog.test.ts src/app/api/__tests__/ai-analysis.test.ts   # selected files
```

- Tests run offline. A setup file blocks outgoing network connections, removes inherited credentials and training
  settings, and points the credential store at a scratch directory. Provider, Street View and Maps responses come
  from fakes.
- Passing tests do not show that live provider calls, model output quality or imagery availability work.
- Run the test files that cover what you changed: for example, `src/lib/server/__tests__/` for server modules and
  `src/app/api/__tests__/` for routes.
- `npm run lint` currently runs `next lint`, but ESLint is not a project dependency, so there is no working lint
  setup yet. `npm run typecheck` and the tests are the available checks.
- Project layout:
  - `src/app` holds pages and API routes;
  - `src/lib/server` holds server-only modules (configuration, training access, catalog, provider adapters);
  - `src/lib/analysis/contract.ts` is the analysis format shared with the browser;
  - `scripts/auth.ts` is the `auth` command.

## Known limitations

- The lockfile and development runtime need security maintenance before public deployment. Review the
  [Next.js security releases](https://nextjs.org/blog/security) and
  [Node.js security releases](https://nodejs.org/en/blog/vulnerability).
- **The analyzed image can differ from the panorama on screen.** Scene analysis fetches a Static image at the round's
  coordinates, facing north and level. The browser opens the nearest panorama within 1 km and lets you move. Scoring
  uses the round's coordinates.
- If a new location cannot be loaded, the round silently falls back to central Paris.
- The pages have no model picker yet. They use the catalog default (see [Providers and models](#providers-and-models)).
- Model behavior has not been verified against the live APIs, including structured output, error bodies, output
  token headroom for reasoning and image token cost.
- There is no CI and no working lint setup.
