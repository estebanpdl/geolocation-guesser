# Codebase Structure

**Analysis Date:** 2026-02-24

## Directory Layout

```
geolocation-guesser/
├── .claude/                       # GSD workflow framework (generated)
├── .agents/                       # Claude Code skills for context
│   └── skills/
│       ├── frontend-design/
│       ├── next-best-practices/
│       └── vercel-react-best-practices/
├── .planning/                     # Planning documents (generated)
│   └── codebase/                  # Architecture & structure analysis
├── .git/                          # Git repository (generated)
├── src/
│   ├── app/
│   │   ├── (layout.tsx)           # Root layout with providers
│   │   ├── page.tsx               # Home page (landing)
│   │   ├── game/
│   │   │   └── page.tsx           # Main game page
│   │   ├── api/
│   │   │   ├── generate-location/
│   │   │   │   └── route.ts       # Generate random coordinates
│   │   │   ├── validate-streetview/
│   │   │   │   └── route.ts       # Validate Street View availability
│   │   │   ├── score/
│   │   │   │   └── route.ts       # Calculate distance and score
│   │   │   ├── sessions/
│   │   │   │   └── route.ts       # Session CRUD operations
│   │   │   └── ai-analysis/
│   │   │       └── route.ts       # Optional: AI landmark detection
│   │   └── layout.tsx             # App-specific layout
│   ├── components/
│   │   ├── StreetViewCanvas.tsx   # Google Street View panorama
│   │   ├── GuessMap.tsx           # Interactive map for guessing
│   │   ├── HypothesisPanel.tsx    # Hypothesis form
│   │   ├── AIAssistantPanel.tsx   # AI assistance sidebar
│   │   ├── GameLayout.tsx         # Main game container
│   │   └── common/
│   │       ├── Button.tsx         # Reusable button
│   │       ├── Card.tsx           # Reusable card
│   │       └── Loading.tsx        # Loading spinner
│   ├── lib/
│   │   ├── distance.ts            # Haversine formula implementation
│   │   ├── coordinates.ts         # Coordinate generation utilities
│   │   ├── session.ts             # Session management service
│   │   ├── api-client.ts          # API client for frontend→backend calls
│   │   └── types.ts               # Shared TypeScript types
│   ├── utils/
│   │   ├── constants.ts           # App constants (coordinate bounds, scoring thresholds)
│   │   ├── validators.ts          # Input validation helpers
│   │   └── formatters.ts          # Display formatting helpers
│   ├── hooks/
│   │   ├── useGameRound.ts        # Game round state and logic
│   │   ├── useSession.ts          # Session management hook
│   │   └── useGoogleMaps.ts       # Google Maps API initialization
│   ├── styles/
│   │   ├── globals.css            # Global styles
│   │   └── variables.css          # CSS variables and theme
│   └── env.ts                     # Validated environment variables
├── public/
│   ├── favicon.ico
│   └── images/
│       └── (static assets)
├── tests/
│   ├── unit/
│   │   ├── distance.test.ts       # Unit tests for Haversine
│   │   ├── coordinates.test.ts    # Unit tests for coordinate generation
│   │   └── validators.test.ts     # Unit tests for validation
│   ├── integration/
│   │   ├── api.test.ts            # API route tests
│   │   └── game-flow.test.ts      # Full game flow tests
│   └── setup.ts                   # Test environment setup
├── .env.local                     # Local environment variables (not committed)
├── .env.example                   # Example env vars (template)
├── .eslintrc.json                 # ESLint configuration
├── .prettierrc.json               # Prettier configuration
├── next.config.js                 # Next.js configuration
├── tsconfig.json                  # TypeScript configuration
├── jest.config.js                 # Jest configuration (if used)
├── vitest.config.ts               # Vitest configuration (if used)
├── package.json                   # Dependencies and scripts
├── package-lock.json              # Dependency lock file
├── CLAUDE.md                      # Claude Code guidance document
├── PROJECT.md                     # Architecture specification
├── README.md                      # Project README
└── .gitignore                     # Git ignore rules
```

## Directory Purposes

**src/app/**
- Purpose: Next.js App Router pages and API routes (Next.js 13+ App Router structure)
- Contains: Page components (TSX) and API route handlers (TypeScript)
- Key files: `page.tsx` (pages), `route.ts` (API handlers), `layout.tsx` (layouts)

**src/app/game/**
- Purpose: Main game page container
- Contains: Game round logic, component orchestration
- Key files: `page.tsx` (game page layout and round management)

**src/app/api/**
- Purpose: Backend API endpoints for game logic and external API integration
- Contains: Route handler TypeScript files for each endpoint
- Key files: `generate-location/route.ts`, `score/route.ts`, `sessions/route.ts`, `ai-analysis/route.ts`

**src/components/**
- Purpose: Reusable React components for the game UI
- Contains: Component TSX files and optional component-level styles
- Key files: Major components (`StreetViewCanvas`, `GuessMap`, `HypothesisPanel`, `AIAssistantPanel`)

**src/components/common/**
- Purpose: Shared UI primitives (buttons, cards, spinners)
- Contains: Generic, reusable components used across pages
- Key files: `Button.tsx`, `Card.tsx`, `Loading.tsx`

**src/lib/**
- Purpose: Core business logic, utilities, and service classes
- Contains: Distance calculations, coordinate generation, session management, API client
- Key files: `distance.ts`, `coordinates.ts`, `session.ts`, `types.ts`

**src/utils/**
- Purpose: Helper functions for validation, formatting, and constants
- Contains: Validators, formatters, and constant definitions
- Key files: `constants.ts`, `validators.ts`, `formatters.ts`

**src/hooks/**
- Purpose: Custom React hooks for state and side effects
- Contains: Game logic hooks, session management, API integration
- Key files: `useGameRound.ts`, `useSession.ts`, `useGoogleMaps.ts`

**src/styles/**
- Purpose: Global styles and CSS variables
- Contains: Tailwind config (if used), global CSS, theme definitions
- Key files: `globals.css`, `variables.css`

**public/**
- Purpose: Static assets served directly by Next.js
- Contains: Images, icons, fonts, and other static files
- Key files: `favicon.ico`, images directory

**tests/**
- Purpose: Test files organized by type (unit, integration)
- Contains: Jest/Vitest test files with `.test.ts` or `.spec.ts` naming
- Key files: Tests for utilities, API routes, and game flows

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx`: Root layout with HTML structure, metadata, and providers
- `src/app/page.tsx`: Landing/home page accessible at `/`
- `src/app/game/page.tsx`: Main game page accessible at `/game`

**Configuration:**
- `tsconfig.json`: TypeScript compilation and path aliases
- `next.config.js`: Next.js build and runtime settings
- `.env.local`: Local environment variables (API keys, database URLs)
- `.env.example`: Template showing required environment variables

**Core Logic:**
- `src/lib/distance.ts`: Haversine distance calculation
- `src/lib/coordinates.ts`: Coordinate generation (random and filtered)
- `src/lib/session.ts`: Session management and persistence
- `src/lib/types.ts`: Shared TypeScript type definitions

**Testing:**
- `tests/setup.ts`: Test environment configuration
- `tests/unit/distance.test.ts`: Tests for distance calculation
- `tests/integration/api.test.ts`: Tests for API endpoints

## Naming Conventions

**Files:**
- **Pages:** `page.tsx` (Next.js convention)
- **API routes:** `route.ts` in `api/[endpoint]/` directories
- **Components:** PascalCase (e.g., `StreetViewCanvas.tsx`, `GuessMap.tsx`)
- **Utilities:** camelCase (e.g., `distance.ts`, `validators.ts`)
- **Tests:** filename + `.test.ts` or `.spec.ts` (e.g., `distance.test.ts`)
- **Hooks:** `useXxx.ts` (e.g., `useGameRound.ts`, `useSession.ts`)
- **Types:** `XxxType` or `Xxx` interface (e.g., `GameRound`, `Hypothesis`)

**Directories:**
- **Feature directories:** kebab-case (e.g., `game`, `api`, `common`)
- **API directories:** kebab-case matching endpoint name (e.g., `generate-location`, `validate-streetview`)

## Where to Add New Code

**New Feature (e.g., Leaderboard):**
- Primary code: Create `src/app/leaderboard/page.tsx`
- API layer: Add `src/app/api/leaderboard/route.ts`
- Components: Add to `src/components/LeaderboardTable.tsx`
- Tests: Add `tests/integration/leaderboard.test.ts`

**New Component/Module:**
- Implementation: `src/components/YourComponent.tsx` (if UI) or `src/lib/yourService.ts` (if logic)
- Tests: `tests/unit/yourService.test.ts`
- Types: Add to `src/lib/types.ts` or create `src/lib/yourTypes.ts`

**Utilities and Helpers:**
- Shared helpers: `src/utils/yourHelper.ts` (simple functions)
- Business logic: `src/lib/yourService.ts` (classes or complex functions)
- Constants: `src/utils/constants.ts` (centralized)
- Validators: `src/utils/validators.ts` (input validation)

## Special Directories

**src/app/**
- Purpose: Next.js App Router (v13+) directory
- Generated: No, manually created
- Committed: Yes, all source files committed
- Note: Each `page.tsx` becomes a route, each `route.ts` becomes an API endpoint

**.env.local**
- Purpose: Local environment variables (secrets, API keys)
- Generated: Created manually by developer
- Committed: No (in .gitignore)
- Note: Use `.env.example` as template; never commit actual `.env.local`

**tests/**
- Purpose: Test suite files
- Generated: No, manually created
- Committed: Yes, all test files committed
- Note: Test files run via `npm test` or `npm run test:watch`

**public/**
- Purpose: Static assets served directly (images, fonts)
- Generated: No, manually created or copied
- Committed: Yes, static assets committed (except large binaries if needed in CDN)
- Note: Files in this directory are served at `/` root path

**node_modules/**
- Purpose: Installed dependencies
- Generated: Yes, created by `npm install`
- Committed: No (in .gitignore)
- Note: Restore with `npm install` or `npm ci`

## Configuration File Locations

**Environment Variables:**
- `src/env.ts`: Runtime validation of required environment variables (recommended pattern)
- `.env.example`: Template showing required vars

**Build & Development:**
- `next.config.js`: Next.js configuration (redirects, rewrites, image optimization)
- `tsconfig.json`: TypeScript settings and path aliases
- `tsconfig.build.json`: Optional additional build-specific TS config

**Linting & Formatting:**
- `.eslintrc.json`: ESLint rules for code quality
- `.prettierrc.json`: Prettier rules for code formatting

**Testing:**
- `jest.config.js` or `vitest.config.ts`: Test framework configuration

---

*Structure analysis: 2026-02-24*
