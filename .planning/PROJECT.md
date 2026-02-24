# GeoINT Trainer

## What This Is

An OSINT geolocation training platform for small groups. Users explore Google Street View panoramas, form structured hypotheses about their location, place guesses on a map, and receive distance-based scoring. A Gemini-powered AI assistant provides full scene analysis to support learning. Think GeoGuessr rebuilt as a pedagogical tool where analytical reasoning matters more than speed.

## Core Value

Users develop geolocation analysis skills through structured hypothesis-driven practice with AI-assisted feedback — not just "guess and check."

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] User can enter a name/alias to start a session (no auth, no passwords)
- [ ] User can start a fixed-round session (e.g., 5 rounds)
- [ ] User sees a Google Street View panorama for a randomly generated, validated coordinate
- [ ] User can explore the panorama freely (rotate, zoom, move)
- [ ] User can load curated location sets by region or theme instead of random
- [ ] User sees a hypothesis panel alongside the panorama with fields: country, city, landmark, confidence (1-5), evidence notes
- [ ] Hypothesis panel is prominent but not required before guessing
- [ ] User can place a guess by clicking on a map
- [ ] System calculates distance using Haversine formula and returns score with accuracy category
- [ ] After guessing, user sees their guess vs actual location on the map with distance
- [ ] User can trigger AI scene analysis (Gemini vision) that provides full explanation: landmarks, text/OCR, architecture style, road signs, languages, flags, license plates
- [ ] AI analysis panel shows results alongside the panorama
- [ ] After all rounds, user sees session summary with total score, per-round breakdown, and hypotheses logged
- [ ] Sessions are stored locally so users can review past performance

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- User accounts / authentication — small group, named sessions are sufficient
- Public leaderboards — not needed for small group use
- Multiple AI assistance modes (locked/hints/confidence-scored) — ship with full explanation only, add progressive modes later
- Real-time multiplayer — not core to the training objective
- Endless/free practice mode — fixed rounds only for v1
- Mobile-native app — web-first, responsive is fine
- Multiple AI providers — Gemini only for v1, add OpenAI/Claude later

## Context

The existing repository contains `PROJECT.md` (architecture reference document), a `CLAUDE.md` guidance file, and Claude Code infrastructure (GSD framework, agent skills for frontend-design, next-best-practices, vercel-react-best-practices). No application source code exists yet — this is a greenfield implementation.

The architecture reference in the root `PROJECT.md` outlines the planned technical approach: Next.js App Router, Google Maps JavaScript API, Google Street View API, Haversine distance calculation, and a component structure around `<StreetViewCanvas>`, `<GuessMap>`, `<AIAssistantPanel>`, and `<HypothesisPanel>`.

Target users are a small group doing OSINT training together. The emphasis is on building analytical reasoning skills through structured hypothesis logging, not competitive gaming.

## Constraints

- **API dependency**: Google Maps JavaScript API + Street View API required — needs API key with billing enabled
- **AI provider**: Gemini vision API for scene analysis — needs API key
- **Framework**: Next.js with App Router (aligns with installed skills and reference architecture)
- **Storage**: Local/lightweight for v1 — no external database required initially
- **Street View coverage**: Not all coordinates have Street View — validation step is mandatory before presenting a location

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Next.js App Router | Matches reference architecture, installed skills, and modern React patterns | — Pending |
| Gemini for AI vision | User preference for v1 AI provider | — Pending |
| Named sessions (no auth) | Small group use case doesn't warrant authentication complexity | — Pending |
| Fixed rounds only | Clearer session structure for training review and scoring | — Pending |
| Hypothesis panel optional | Encourages analytical thinking without blocking the core experience | — Pending |
| Local storage for sessions | Simplest persistence for small group, avoids database setup | — Pending |

---
*Last updated: 2026-02-24 after initialization*
