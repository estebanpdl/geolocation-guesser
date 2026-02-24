# Architecture

**Analysis Date:** 2026-02-24

## Pattern Overview

**Overall:** Client-Server with Full-Stack JavaScript (Next.js) + React

**Key Characteristics:**
- **Full-stack framework:** Next.js App Router (TypeScript) handles both client and server logic
- **Layered architecture:** Separation of concerns across UI, API routes, and utilities
- **External API integration:** Google Maps JS API and Street View API for panorama rendering and geolocation services
- **Pedagogical design:** Multi-stage hypothesis logging system with optional AI assistance for structured learning
- **Distance-based scoring:** Server-side calculation using Haversine formula for geographic accuracy metrics

## Layers

**Frontend (React Components):**
- Purpose: Interactive UI for Street View exploration, map-based guessing, and AI assistance
- Location: `src/app/` and `src/components/`
- Contains: React components, hooks, client-side state management
- Depends on: Google Maps JS API, next/navigation, server API routes
- Used by: Browser clients via Next.js App Router

**Backend (Next.js API Routes):**
- Purpose: Core business logic for coordinate generation, Street View validation, distance calculation, and session persistence
- Location: `src/app/api/`
- Contains: Route handlers for `/api/generate-location`, `/api/validate-streetview`, `/api/score`, `/api/sessions`
- Depends on: Google Street View API, external AI APIs (optional), persistence layer
- Used by: Frontend components via fetch/axios

**External Services Layer:**
- Purpose: Integration with third-party APIs for mapping, panoramas, and AI analysis
- Contains: Google Street View API, Google Maps JavaScript API, optional AI providers (OpenAI/Claude/Gemini)
- Connection points: Frontend (Maps JS), Backend (Street View metadata validation), Optional AI endpoints

**Utilities & Helpers:**
- Purpose: Shared calculations, constants, and helper functions
- Location: `src/lib/` and `src/utils/`
- Contains: Haversine distance calculator, coordinate validators, type definitions
- Depends on: None (utility layer)
- Used by: All other layers

## Data Flow

**Game Round Flow (Primary):**

1. **Round Initialization**
   - User accesses game page
   - Frontend requests `/api/generate-location`
   - Backend generates random coordinates (lat, lng) within valid range
   - Backend validates Street View availability via Google API metadata endpoint
   - Backend returns valid coordinates to frontend

2. **Street View Display**
   - Frontend receives coordinates from API
   - `<StreetViewCanvas>` component initializes Google StreetViewPanorama object
   - Panorama renders with user location hidden
   - User can pan/zoom panorama to gather clues

3. **Hypothesis Formation**
   - User fills `<HypothesisPanel>` form with:
     - Country hypothesis
     - City hypothesis
     - Landmark hypothesis
     - Confidence level (1-5)
     - Evidence notes
   - Frontend stores hypothesis in local state

4. **Guess Submission**
   - User clicks on `<GuessMap>` component to place marker
   - Frontend captures clicked coordinates (guessLat, guessLng)
   - Frontend sends to `/api/score` with: actual coordinates + guessed coordinates + hypothesis data
   - Backend calculates Haversine distance
   - Backend returns: distance (km), accuracy category, session update

5. **Round Completion**
   - Frontend displays results and score
   - Session state updates with guess history
   - User can start next round or review statistics

**AI Assistance Flow (Optional):**

1. User clicks "Analyze Image" in `<AIAssistantPanel>`
2. Frontend sends Street View image to `/api/ai-analysis` (or direct to external AI API)
3. Backend calls OpenAI Vision / Claude Vision / Gemini depending on user config
4. AI returns: detected text, landmarks, road signs, architecture style, language hints, flag identification
5. Frontend displays results with confidence levels based on selected assistance mode (locked / hints-only / full / scored)

**Session Persistence Flow:**

1. Session created when user starts game
2. Each round's hypothesis and guess are logged via `/api/sessions`
3. Backend stores session data (rounds, scores, hypotheses, timestamps)
4. User can later review session history and analytics

**State Management:**

- **Client state:** React component state or Context API for round UI state, hypothesis form, and temporary session data
- **Server state:** Next.js database layer stores persisted sessions, user scores, and round history
- **URL state:** Game round ID and session ID passed via URL parameters or server-side sessions

## Key Abstractions

**StreetViewCanvas Component:**
- Purpose: Encapsulates Google Street View panorama rendering logic
- Location: `src/components/StreetViewCanvas.tsx`
- Pattern: Controlled React component with useEffect for API initialization
- Props: `{ lat: number; lng: number; onImageLoaded?: () => void }`

**GuessMap Component:**
- Purpose: Interactive map interface for placing guess markers
- Location: `src/components/GuessMap.tsx`
- Pattern: Event-driven component that emits guess coordinates on map click
- Props: `{ onGuess: (lat: number, lng: number) => void; realLat?: number; realLng?: number }`

**HypothesisPanel Component:**
- Purpose: Structured form for recording analytical hypotheses before guessing
- Location: `src/components/HypothesisPanel.tsx`
- Pattern: Form component with validation, stores hypothesis object in state
- Props: `{ onSubmit: (hypothesis: Hypothesis) => void }`
- Hypothesis type: `{ country: string; city: string; landmark: string; confidence: 1-5; evidence: string }`

**AIAssistantPanel Component:**
- Purpose: Optional sidebar for AI-powered landmark detection and OCR
- Location: `src/components/AIAssistantPanel.tsx`
- Pattern: Conditional rendering based on user settings, displays detection results
- Props: `{ imageUrl: string; assistanceMode: 'locked' | 'hints' | 'full' | 'scored' }`

**Distance Calculator Utility:**
- Purpose: Pure function implementing Haversine formula
- Location: `src/lib/distance.ts`
- Pattern: Functional utility with unit tests
- Function: `haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number`

**Coordinate Generator Utility:**
- Purpose: Pure random coordinate generation with optional filtering
- Location: `src/lib/coordinates.ts`
- Pattern: Functional utilities for MVP (random) and future (filtered) implementations
- Functions: `generateRandomCoordinate()`, `generateFilteredCoordinate(filters: CoordinateFilters)`

**Session Manager:**
- Purpose: Encapsulates session CRUD and round history tracking
- Location: `src/lib/session.ts`
- Pattern: Service class with async methods for database interaction
- Methods: `createSession()`, `addRound()`, `getSessionHistory()`, `recordGuess()`

## Entry Points

**Main Game Page:**
- Location: `src/app/game/page.tsx`
- Triggers: User navigates to `/game` route
- Responsibilities:
  - Renders main game layout with StreetViewCanvas, GuessMap, HypothesisPanel, AIAssistantPanel
  - Manages game round state and transitions
  - Orchestrates API calls for coordinate generation and scoring

**Home Page:**
- Location: `src/app/page.tsx`
- Triggers: User navigates to `/` (root)
- Responsibilities: Landing page with instructions, game mode selection, links to settings/history

**API Route: Generate Location**
- Location: `src/app/api/generate-location/route.ts`
- Triggers: `GET /api/generate-location` from frontend
- Responsibilities:
  - Generate random coordinates
  - Validate Street View availability
  - Return safe coordinates object

**API Route: Score Guess**
- Location: `src/app/api/score/route.ts`
- Triggers: `POST /api/score` with real and guessed coordinates
- Responsibilities:
  - Calculate Haversine distance
  - Determine accuracy category (Excellent/Good/Poor)
  - Return score and round result

**API Route: Sessions**
- Location: `src/app/api/sessions/route.ts`
- Triggers: `GET /api/sessions/{sessionId}` or `POST /api/sessions`
- Responsibilities:
  - Create new game sessions
  - Retrieve session history
  - Log hypothesis and guess data

**API Route: AI Analysis (Optional)**
- Location: `src/app/api/ai-analysis/route.ts`
- Triggers: `POST /api/ai-analysis` with image data
- Responsibilities:
  - Call external AI API (OpenAI/Claude/Gemini)
  - Extract landmarks, text, architecture styles
  - Return structured analysis results

## Error Handling

**Strategy:** Graceful degradation with user-friendly error messages

**Patterns:**

- **Street View unavailable:** If coordinates fail validation, backend auto-generates new location and retries
- **API failures:** Catch errors from Google APIs, return fallback empty state with retry button
- **Network errors:** Frontend catches fetch failures, displays "Connection lost" message with retry
- **Invalid guesses:** Validate coordinate ranges on both client and server, return 400 Bad Request
- **Session errors:** If session lookup fails, create new session and continue
- **AI API failures (optional):** If AI call times out or fails, disable assistance mode but continue game

## Cross-Cutting Concerns

**Logging:**
- Server-side logging in API routes using console.log or structured logger (e.g., pino)
- Log coordinate generation, Street View validations, and scoring calculations
- Log session creation and round completions for analytics

**Validation:**
- Client-side: React form validation in HypothesisPanel and GuessMap
- Server-side: Validate all coordinates against geographic bounds (-85 to +85 latitude, -180 to +180 longitude)
- Validate all incoming guess data to prevent injection or out-of-range values

**Authentication:**
- Not required for MVP (public game)
- Placeholder for future: Add optional user accounts via NextAuth for session persistence
- Optional: Implement rate limiting on API routes to prevent abuse

**CORS & Security:**
- Next.js handles CORS automatically for same-origin requests
- External API calls (Google, AI) use server-side credentials via environment variables
- Ensure API keys are never exposed to frontend (handle via backend routes only)

---

*Architecture analysis: 2026-02-24*
