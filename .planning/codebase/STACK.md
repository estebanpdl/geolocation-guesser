# Technology Stack

**Analysis Date:** 2026-02-24

**Status:** Pre-implementation. No application code exists yet. This document describes the planned technology stack from PROJECT.md and CLAUDE.md.

## Languages

**Primary:**
- TypeScript - Full application development (frontend and backend)

**Secondary:**
- JavaScript - Build tooling and configuration files

## Runtime

**Environment:**
- Node.js (version not specified in PROJECT.md - recommend 18 LTS or later)

**Package Manager:**
- npm (typical for Next.js projects)
- Lockfile: Will be `package-lock.json` after scaffolding

## Frameworks

**Core:**
- Next.js (App Router) - Full-stack web framework for routing, API routes, and server-side rendering
- React - Frontend UI component library and rendering

**Build/Dev:**
- TypeScript - Type checking and compilation
- Vercel deployment (inferred from Next.js usage pattern)

## Key Dependencies

**Frontend Libraries (Planned):**
- `next` - Next.js framework and App Router
- `react` - React library
- `react-dom` - React DOM rendering
- Google Maps JavaScript API - Street View panorama rendering and map interaction
  - Loaded via `<script>` tag in HTML or via `@react-google-maps/api` package
- Map library (TBD) - For guess placement interaction (Leaflet, Mapbox, or Google Maps SDK)

**Backend Utilities:**
- TypeScript compiler (`typescript`)
- ESLint (`eslint`, `@typescript-eslint/*`) - Code linting
- Prettier - Code formatting (assumed from modern Next.js setup)

**Data & Calculations:**
- No ORM specified (likely raw calculations or minimal persistence initially)
- Haversine formula for distance calculation (implemented directly in JavaScript)

**AI Integration (Optional):**
- OpenAI SDK (`openai`) - If using OpenAI for landmark detection
- Anthropic SDK (`@anthropic-ai/sdk`) - If using Claude for landmark detection
- Google Generative AI SDK - If using Gemini for landmark detection
- (Only one or none required for MVP)

**Testing (Assumed):**
- Vitest or Jest - Unit and integration testing (common for Next.js)
- React Testing Library - Component testing (typical choice)

## Configuration

**Environment:**
- `.env.local` - Local development environment variables (required for API keys)
- `.env.production` - Production environment variables
- Key environment variables (planned, from PROJECT.md):
  - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` - Google Maps API key (public)
  - `OPENAI_API_KEY` (if using OpenAI) - Secret API key
  - `ANTHROPIC_API_KEY` (if using Claude) - Secret API key
  - `GOOGLE_GENERATIVE_AI_KEY` (if using Gemini) - Secret API key
  - Database connection string (if persistence layer added beyond MVP)

**Build:**
- `next.config.js` or `next.config.ts` - Next.js configuration
- `tsconfig.json` - TypeScript compiler configuration
- `.eslintrc.json` - ESLint configuration (when project is initialized)
- `.prettierrc` or `.prettierrc.json` - Prettier formatting configuration (when project is initialized)
- `package.json` - Project manifest with scripts:
  - `npm run dev` - Start development server
  - `npm run build` - Create production build
  - `npm run start` - Run production server
  - `npm run lint` - Run ESLint
  - `npm test` - Run test suite (when tests are written)

## Platform Requirements

**Development:**
- Node.js 18+ (recommended; Next.js 15 supports Node.js 18 and above)
- npm 8+ (or yarn/pnpm as alternative)
- Modern browser with Google Maps API support
- Google Maps JavaScript API key for local development and testing

**Production:**
- Vercel (optimal choice for Next.js, as per Vercel's framework)
- Alternative: Any platform supporting Node.js (AWS, GCP, Azure, etc.)
- Google Maps API key provisioned in production environment
- Optional: AI API keys (OpenAI, Anthropic, Google) if AI features enabled

## Architecture-Specific Dependencies

**From PROJECT.md specification:**

1. **Location Engine** - Custom implementation, no dependencies
   - Generates random coordinates: latitude (-85 to +85), longitude (-180 to +180)
   - Validates against Google Street View API metadata endpoint
   - No external library required

2. **Street View Renderer** - Google Maps JavaScript API
   - `StreetViewPanorama` object from Maps API
   - Handles panorama loading and availability validation

3. **Scoring System** - Custom JavaScript implementation
   - Haversine formula for distance calculation (pure math, no library)
   - Returns distance in km and accuracy category

4. **Session/Persistence** (if MVP includes sessions)
   - Likely in-memory for MVP, or simple JSON file storage
   - Future: Database adapter (PostgreSQL, MongoDB, etc. TBD)

5. **AI Assistance Panel** (optional, customer-enabled)
   - Vision model for OCR and landmark detection
   - Requires integration with chosen AI provider

---

*Stack analysis: 2026-02-24 | Pre-implementation planning based on PROJECT.md and CLAUDE.md*
