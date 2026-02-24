# Codebase Concerns

**Analysis Date:** 2026-02-24

## Overview

This is a pre-implementation project with architectural planning but no source code yet. Concerns identified are based on planned architecture in `PROJECT.md` and anticipated risks for a Next.js + Google Maps + AI-assisted geolocation training platform.

---

## Tech Debt & Architectural Risks

**Google Maps API Dependency & Cost**
- Issue: Heavy reliance on Google Street View API and Google Maps JavaScript API with no fallback strategy. Street View coverage is incomplete globally, especially in developing countries (which are critical for OSINT training). API costs can escalate quickly with user scale.
- Files: Planned `/api/generate-location`, `<StreetViewCanvas>` component
- Impact: Functional gaps in geographic coverage, unexpected infrastructure costs, potential service availability issues if quotas exceeded
- Fix approach: Implement fallback coordinate validation strategy; add Street View availability pre-check before returning coordinates; implement rate limiting and quota monitoring from day 1; consider alternative datasets (e.g., user-contributed imagery) for Phase 2

**Floating-Point Precision in Scoring (Haversine)**
- Issue: The Haversine distance formula uses floating-point arithmetic. Small rounding errors in latitude/longitude can accumulate. No error tolerance defined for "close enough" scoring thresholds.
- Files: Planned `/api/score` endpoint
- Impact: Users may report inconsistent or unfair scoring; edge cases at poles or date line could behave unpredictably
- Fix approach: Define explicit tolerance ranges (e.g., ±0.0001 degrees = ~10m precision); document rounding strategy in scoring; add unit tests for poles, date line, antipode cases; consider using high-precision decimal library if money-based scoring is added later

**Missing Session Persistence Layer Specification**
- Issue: Architecture mentions "Session Logger" and `/api/sessions` endpoint but provides no detail on persistence strategy, data retention, or cleanup. No schema defined.
- Files: Planned `/api/sessions` endpoint
- Impact: Sessions could accumulate unbounded in database; unclear how to handle abandoned sessions; no audit trail defined; potential data leak if session IDs are predictable
- Fix approach: Define session schema with TTL, user ID, created_at, updated_at; implement server-side session validation; use cryptographically secure session IDs; add cleanup job for expired sessions; clarify GDPR/privacy implications before launch

**AI API Integration Fragility**
- Issue: Four AI assistance modes planned (locked → hints → full → confidence-scored) but no specification for API fallback, rate limits, error handling, or cost tracking. Optional AI APIs (OpenAI, Claude, Gemini) are mentioned but selection logic undefined.
- Files: Planned `<AIAssistantPanel>` component, AI backend service
- Impact: If AI API fails, entire feature silently degrades or returns stale data; users see degraded experience without understanding why; costs could spike if model selection or caching strategy is wrong
- Fix approach: Design explicit fallback UI states (error badge, hint disabled, etc.); implement circuit breaker pattern for AI endpoints; add comprehensive error logging; require explicit user API key entry vs. server-side secrets; implement request caching to reduce API calls; create detailed cost monitoring from MVP

**Hypothesis Panel Data Loss Risk**
- Issue: Required hypothesis logging (country, city, landmark, confidence, evidence notes) has no specified persistence. If user navigates away or loses connection, data could be lost with no recovery option.
- Files: Planned `<HypothesisPanel>` component
- Impact: Users frustrated by lost work; pedagogical data (evidence notes) irretrievable; incomplete audit trail for OSINT training platform
- Fix approach: Implement client-side autosave to localStorage with server sync; add visual feedback for save status; implement conflict resolution for concurrent edits; add recovery UI for unsaved drafts

---

## Security Concerns

**User Geolocation Data Privacy**
- Risk: User guesses, hypotheses, and viewing patterns create a detailed geolocation metadata trail. No privacy policy or data minimization strategy defined.
- Files: Planned session schema, `/api/sessions` endpoint, `<HypothesisPanel>`
- Current mitigation: None specified in architecture
- Recommendations: Define data retention policy (suggest: delete after 30 days if not in active learning); anonymize logs before analytics; add user consent banners for data collection; encrypt PII at rest; implement data export/deletion endpoints (GDPR compliance); audit third-party dependencies for data exfiltration

**AI Vision Model Input Validation**
- Risk: If users can upload images or the system processes panorama metadata through AI vision APIs, input injection or adversarial attacks could occur. No input sanitization strategy defined.
- Files: Planned `<AIAssistantPanel>` component, vision API integration
- Current mitigation: None specified
- Recommendations: Validate and sanitize all input before sending to AI APIs; implement rate limiting per user/session; log all AI queries for security audit; document which image data is sent to external APIs; avoid sending full panorama data to untrusted services

**API Rate Limiting & DDoS**
- Risk: `/api/score`, `/api/generate-location`, and AI endpoints have no specified rate limiting. Malicious users could overwhelm the service or rack up costs.
- Files: All API route files (not yet created)
- Current mitigation: None specified
- Recommendations: Implement per-user rate limiting (e.g., 10 guesses/minute); add CAPTCHA for high-frequency requests; implement request signing if API calls are from mobile clients; add firewall rules at CDN/infrastructure level

**Coordinate Generation Predictability**
- Risk: "Pure random" coordinate generation (Option A in MVP) with no seed validation could be exploited. If RNG is not cryptographically secure, users could predict sequences.
- Files: Planned `/api/generate-location` endpoint
- Current mitigation: None specified
- Recommendations: Use cryptographically secure RNG (not Math.random); avoid seeding RNG with timestamps; add entropy validation tests; consider pre-generating coordinate sets server-side if predictability becomes issue

---

## Performance Bottlenecks

**Street View Panorama Loading**
- Problem: Google Street View API calls are synchronous and can take 2-5 seconds per coordinate. If validation is done on each request without caching, loading feels slow.
- Files: Planned `<StreetViewCanvas>` component, `/api/validate-streetview` endpoint
- Cause: No caching strategy for Street View metadata; no preloading; potential unoptimized images
- Improvement path: Implement 2-3 coordinate preload pipeline; cache Street View availability metadata for 7 days; use Next.js Image optimization for panorama thumbnails; implement skeleton screens during loading; consider CDN-adjacent caching

**AI Vision API Response Latency**
- Problem: Vision APIs (OpenAI, Claude) have 1-10 second response times. Running serially for each request will cause visible lag.
- Files: Planned `<AIAssistantPanel>` component
- Cause: No batching, no speculative execution, no response caching
- Improvement path: Implement optimistic UI with local model predictions while waiting for API response; cache AI analyses for repeated coordinates; batch landmark detection requests; consider running model locally for hints-only mode (faster, no API call)

**Database Connection Pooling**
- Problem: Session persistence will require DB connections. No connection pool configuration specified.
- Files: Planned session persistence layer
- Cause: No infrastructure-as-code or deployment configuration yet
- Improvement path: Configure connection pool size based on expected concurrency; implement automatic reconnection; add connection timeout and idle timeout limits; monitor pool utilization

**Client-Side Bundle Size**
- Problem: Including Google Maps JS API, Street View, AI client libraries, and React could create large initial bundle.
- Files: Planned frontend bundle
- Cause: No code-splitting or lazy-loading strategy defined
- Improvement path: Lazy-load Google Maps only on game page; use dynamic imports for AI assistant (disabled on initial load); implement route-based code splitting in Next.js; tree-shake unused Google Maps features

---

## Fragile Areas

**API Key Exposure in Frontend**
- Files: Planned `<StreetViewCanvas>` component, `/api/score` component
- Why fragile: Google Street View API requires API key. If exposed in client code, it's vulnerable to malicious use and quota theft. Architecture doesn't specify frontend vs. backend API calls.
- Safe modification: Always call Street View API through backend `/api/*` endpoints; use Next.js API Routes as proxy; implement server-side validation of coordinates before rendering; never embed Google API keys in frontend code
- Test coverage: Need integration tests verifying API key is never logged/exposed; add secret scanning to CI/CD

**Coordinate Validation Logic**
- Files: Planned `/api/validate-streetview` endpoint
- Why fragile: Street View availability check is critical path. If it fails silently or returns stale data, users get "no image available" errors. No fallback to alternative imagery.
- Safe modification: Wrap Street View validation in try/catch with detailed error logging; implement exponential backoff for API retries; store validation results with timestamp for cache invalidation; add manual fallback coordinate list for demo/testing
- Test coverage: Unit tests for all possible Street View API response codes; integration tests with real API (or mock); edge case tests for poles, ocean, remote areas

**Haversine Implementation**
- Files: Planned `/api/score` endpoint
- Why fragile: Mathematical formula has edge cases (antipode points, poles, very small distances). Numerical instability possible with certain coordinate pairs.
- Safe modification: Use tested library (e.g., geolib or turf.js) rather than custom implementation; implement range checks before calculation; add assertion for result sanity (distance >= 0, <= Earth circumference); log anomalies
- Test coverage: Unit tests with known coordinate pairs; test poles, equator, date line, antipode; verify consistency with alternate formulas

**Multi-Step Hypothesis Panel State**
- Files: Planned `<HypothesisPanel>` component
- Why fragile: Component manages 5 required fields (country, city, landmark, confidence, evidence). If partial validation is applied, users could submit incomplete data or lose partially entered data on errors.
- Safe modification: Implement explicit state machine (empty → country filled → city filled → etc.); validate each field independently with inline error messages; implement autosave to localStorage at each step; add "save draft" confirmation before navigate away
- Test coverage: Component tests for each field validation; tests for autosave/recovery; E2E tests for typical user flows

---

## Scaling Limits

**Street View API Quota Management**
- Current capacity: Google Street View has per-project quota limits (e.g., 25k daily requests on free tier)
- Limit: At 10 active users, quota exhausts within hours at current rates
- Scaling path: Implement rate limiting and request batching; upgrade to paid tier; cache aggressively; consider mirror servers for popular coordinates

**Database Storage for Sessions**
- Current capacity: Undefined
- Limit: No compression or archival strategy. If storing full panorama data or high-res AI analysis per session, storage grows 100MB+/user
- Scaling path: Archive sessions > 30 days to cold storage; implement compression; store references to coordinates instead of full metadata; implement data pruning policies

**Concurrent WebSocket Connections (If Real-Time Features Added)**
- Current capacity: Not specified
- Limit: Real-time hypothesis feedback could require persistent connections; Node.js default is ~10k connections per process
- Scaling path: Use sticky sessions or session affinity; shard users across multiple instances; implement connection pooling in load balancer

**Google Maps JavaScript API Bandwidth**
- Current capacity: Tile serving is done by Google, but initial map loads consume significant bandwidth
- Limit: At 1000 concurrent users, tile bandwidth could hit limits or incur unexpected costs
- Scaling path: Implement viewport caching; reduce zoom level options; use satellite imagery selectively; monitor bandwidth usage

---

## Missing Critical Features

**No Feedback/Scoring Explainability**
- Problem: Users receive a distance score and accuracy category but no explanation of *why*. For OSINT training, understanding how close they were (e.g., right country, wrong city vs. wrong continent) is pedagogically important.
- Blocks: Effective learning feedback loop; ability to show regional breakdown of guesses for analytics

**No Multiplayer or Leaderboard**
- Problem: Architecture is single-player only. No leaderboard, no competitive engagement, no collaborative hypothesis validation (which would strengthen OSINT skills)
- Blocks: Community engagement; social proof for training platform legitimacy; comparative skill tracking

**No Learning Analytics or Progress Tracking**
- Problem: Architecture doesn't specify how to track which regions/scenarios a user has attempted or their improvement over time. No learning curve analysis.
- Blocks: Structured curriculum design; personalized difficulty progression; ability to prove skill development to instructors

**No Instructor/Admin Features**
- Problem: If this is a training platform (as subtitle suggests), there should be instructor tools: create custom coordinate sets, view student progress, assign challenges.
- Blocks: Classroom integration; structured curriculum; assessment workflows

**No Offline Support**
- Problem: No mention of offline functionality. In OSINT training contexts, connectivity may be unreliable.
- Blocks: Use in offline-heavy environments; caching of reference data; PWA implementation

---

## Test Coverage Gaps

**Distance Calculation Edge Cases**
- What's not tested: Haversine formula with antipode coordinates, identical coordinates, poles, date line crossing
- Files: Planned `/api/score` endpoint
- Risk: Scoring could silently fail or return nonsensical values for certain coordinate pairs
- Priority: High

**Street View API Failure Modes**
- What's not tested: All possible HTTP response codes from Street View API; rate limiting; timeout behavior; partial/degraded responses
- Files: Planned `<StreetViewCanvas>` component, `/api/validate-streetview` endpoint
- Risk: App could crash or hang if API behaves unexpectedly; users get no feedback
- Priority: High

**User Session Integrity**
- What's not tested: Concurrent requests from same session; session expiry; CSRF protection; session replay attacks
- Files: Planned `/api/sessions` endpoint
- Risk: Session hijacking; data corruption from race conditions
- Priority: High

**AI API Integration**
- What's not tested: AI API failures; rate limiting; response validation; fallback behaviors
- Files: Planned `<AIAssistantPanel>` component
- Risk: Silent degradation of AI features; unhandled API errors; cost overruns
- Priority: Medium

**Hypothesis Data Validation**
- What's not tested: Incomplete hypothesis submissions; XSS via evidence notes field; extremely long inputs; special characters
- Files: Planned `<HypothesisPanel>` component, backend validator
- Risk: Data corruption; injection attacks; database errors from oversized inputs
- Priority: Medium

**Coordinate Generation Randomness**
- What's not tested: RNG distribution uniformity; clustering of generated coordinates; predictability
- Files: Planned `/api/generate-location` endpoint
- Risk: Users see non-random pattern; gameplay becomes predictable
- Priority: Low

---

*Concerns audit: 2026-02-24*
