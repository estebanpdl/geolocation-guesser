# External Integrations

**Analysis Date:** 2026-02-24

**Status:** Pre-implementation. No code exists yet. This document describes planned external integrations from PROJECT.md and CLAUDE.md.

## APIs & External Services

**Mapping & Geolocation (Required):**
- **Google Maps JavaScript API** - Core requirement for Street View rendering and map interaction
  - SDK/Client: Loaded via `<script>` tag or `@react-google-maps/api` npm package
  - Auth: API key in `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` environment variable (public key, safe to expose)
  - Purpose:
    - `StreetViewPanorama` object for panorama rendering
    - Panorama metadata endpoint for Street View availability validation
    - Map instance for guess placement (`GuessMap` component)
  - Endpoints:
    - Street View Static API (metadata validation): `https://maps.googleapis.com/maps/api/streetview/metadata`
    - Street View JavaScript API (embedded panorama)
    - Maps JavaScript API (map rendering)

**AI & Vision (Optional, user-enabled):**
- **OpenAI API** - Optional for landmark detection, OCR, and vision analysis
  - SDK/Client: `openai` npm package
  - Auth: API key in `OPENAI_API_KEY` environment variable (secret, backend-only)
  - Purpose: Vision model (GPT-4V) for analyzing Street View images
  - Capabilities: OCR, landmark identification, architecture analysis
  - Usage location: Backend API route `/api/ai-analysis` (TBD) or client-side if token-based auth

- **Anthropic API (Claude)** - Optional alternative for landmark detection and vision analysis
  - SDK/Client: `@anthropic-ai/sdk` npm package
  - Auth: API key in `ANTHROPIC_API_KEY` environment variable (secret, backend-only)
  - Purpose: Claude model for analyzing Street View images, landmark detection
  - Capabilities: Vision analysis, text extraction, reasoning about geographic features
  - Usage location: Backend API route for processing image analysis

- **Google Generative AI (Gemini)** - Optional alternative for landmark detection
  - SDK/Client: Google Generative AI SDK (`@google/generative-ai`)
  - Auth: API key in `GOOGLE_GENERATIVE_AI_KEY` environment variable (secret, backend-only)
  - Purpose: Gemini model for landmark detection and image analysis
  - Capabilities: Vision analysis, OCR, object detection

## Data Storage

**Databases (Not required for MVP):**
- No database specified in PROJECT.md for initial implementation
- MVP storage approach: TBD (likely in-memory or file-based for session tracking)
- Future consideration: PostgreSQL, MongoDB, or similar for:
  - Game sessions
  - User rankings/scores
  - Training data (hypotheses, evidence, user guesses)

**File Storage:**
- Local filesystem only for MVP (no cloud storage integration mentioned)
- Future: May integrate cloud storage (AWS S3, Google Cloud Storage, etc.) for session/game data

**Caching:**
- None specified in PROJECT.md
- Future consideration: Redis for session management and ranking cache

## Authentication & Identity

**Auth Provider:**
- Custom or none (MVP approach from PROJECT.md)
- Not specified in PROJECT.md for initial implementation
- Users likely identified by session ID only
- Future consideration: OAuth2 (Google), email-based, or custom auth for user accounts and leaderboards

## Monitoring & Observability

**Error Tracking:**
- Not specified in PROJECT.md
- Future: Sentry, LogRocket, or similar for error reporting
- Consider for production deployment to Vercel

**Logs:**
- Standard Node.js console logging (captured by Vercel if deployed there)
- Future: Structured logging (Winston, Pino) for backend API routes

## CI/CD & Deployment

**Hosting:**
- **Vercel** - Optimal choice for Next.js applications
  - Automatic deployments from Git
  - Serverless functions for API routes
  - Environment variables managed in Vercel dashboard

**Alternative Platforms:**
- AWS (EC2, Lambda, Amplify)
- Google Cloud Platform (Cloud Run, App Engine)
- Azure (App Service)
- Self-hosted Node.js server

**CI Pipeline:**
- Not specified in PROJECT.md
- Planned when project is scaffolded: GitHub Actions (typical for Next.js on Vercel)

## Environment Configuration

**Required environment variables (MVP):**
```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<Google Maps API key>
```

**Optional environment variables (if AI features enabled):**
```
OPENAI_API_KEY=<OpenAI API key>                    # If using OpenAI
ANTHROPIC_API_KEY=<Anthropic API key>              # If using Claude
GOOGLE_GENERATIVE_AI_KEY=<Gemini API key>          # If using Gemini
```

**Deployment environment variables:**
- Stored in `.env.production` for local builds
- Stored in Vercel dashboard settings for Vercel deployments
- Never committed to git repository

**Secrets location:**
- Development: `.env.local` (git-ignored)
- Staging/Production: Vercel environment secrets (Vercel dashboard)
- Backup: Secure secrets management service (1Password, HashiCorp Vault, etc.)

## Webhooks & Callbacks

**Incoming:**
- None specified in PROJECT.md
- Potential future: Webhooks from AI APIs for async image analysis

**Outgoing:**
- Calls to Google Maps API for Street View metadata validation
- Calls to AI APIs (OpenAI, Claude, Gemini) for image analysis (request-response pattern)
- No webhook callbacks to external systems specified for MVP

## API Route Planning (from PROJECT.md)

**Backend endpoints to implement:**

1. `GET /api/generate-location` or `POST /api/generate-location`
   - Calls: Google Street View metadata API to validate coordinates
   - Returns: Valid latitude, longitude, panorama ID
   - External deps: Google Maps API key

2. `POST /api/validate-streetview`
   - Calls: Google Street View metadata API
   - Returns: Boolean indicating if location has Street View imagery
   - External deps: Google Maps API key

3. `POST /api/score`
   - Calls: Haversine distance calculation (internal)
   - Returns: Distance (km), accuracy category (Excellent/Good/Poor)
   - External deps: None

4. `POST /api/ai-analysis` (optional)
   - Calls: OpenAI/Claude/Gemini Vision API
   - Returns: Landmark detection, OCR results, confidence scores
   - External deps: AI API key (one of: OPENAI, ANTHROPIC, GOOGLE_GENERATIVE_AI)

5. `GET /api/sessions` or `POST /api/sessions`
   - Manages game sessions and state
   - Future: Calls to database for persistence
   - External deps: None (MVP), Database connection string (future)

---

*Integration audit: 2026-02-24 | Pre-implementation planning based on PROJECT.md and CLAUDE.md*
