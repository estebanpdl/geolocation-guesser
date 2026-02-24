# Coding Conventions

**Analysis Date:** 2026-02-24

## Project Context

This document establishes coding conventions for the OSINT Geolocation Training Platform (Next.js + React application). As the codebase is in pre-implementation phase, these conventions are prescriptive and will guide all future development.

## Naming Patterns

**Files:**
- React components: PascalCase (e.g., `StreetViewCanvas.tsx`, `HypothesisPanel.tsx`)
- Utilities and helpers: camelCase (e.g., `haversineDistance.ts`, `validateCoordinates.ts`)
- Hooks: camelCase with `use` prefix (e.g., `useGameState.ts`, `useStreetViewLoader.ts`)
- API routes: kebab-case (e.g., `/api/generate-location`, `/api/validate-streetview`)
- Types/interfaces: PascalCase (e.g., `GameState.ts`, `LocationCoordinates.ts`)

**Functions:**
- React components: PascalCase function name matching filename
- Helper functions: camelCase (e.g., `calculateScore`, `formatDistance`)
- Event handlers: camelCase with `handle` prefix (e.g., `handleGuess`, `handleMapClick`)
- API handlers: camelCase with context (e.g., `POST /api/score` → `scoreGuess()` internally)

**Variables:**
- Constants: UPPER_SNAKE_CASE (e.g., `API_KEY`, `MAX_RADIUS_KM`)
- Boolean variables: camelCase with `is`, `has`, or `can` prefix (e.g., `isLoading`, `hasValidation`, `canSubmit`)
- State variables: camelCase (e.g., `currentLocation`, `guessCoordinates`, `hypothesisData`)

**Types:**
- Interfaces: PascalCase with `I` prefix optional, contextual naming (e.g., `GameSessionState`, `CoordinatePoint`)
- Enums: PascalCase (e.g., `AssistanceMode`, `AccuracyCategory`)
- Union types: PascalCase (e.g., `GuessResult`)

## Code Style

**Formatting:**
- Prettier is configured with Next.js defaults
- Line length: 100 characters (enforced by Prettier)
- Trailing commas: ES5 (enabled in Prettier config)
- Semicolons: Required
- Single quotes for strings: enabled

**Linting:**
- ESLint with `next/core-web-vitals` configuration
- TypeScript strict mode enabled in `tsconfig.json`
- Rule enforcement:
  - No `any` types without explicit comments
  - No unused variables
  - No console statements in production (ESLint rule)
  - Explicit return types on functions

**TypeScript Configuration:**
- `strict: true`
- `noImplicitAny: true`
- `strictNullChecks: true`
- Target: `ES2020`
- Module: `esnext`

## Import Organization

**Order:**
1. Built-in Node.js modules (e.g., `fs`, `path`)
2. External packages (e.g., `react`, `next`, `lodash`)
3. Internal absolute imports from `@` alias
4. Relative imports (e.g., `../utils`, `./components`)
5. Side effects (if needed, at the top)

**Path Aliases:**
- `@/` — Maps to `src/` directory root
- Use absolute imports from `@/` instead of relative paths whenever possible

**Example:**
```typescript
import React, { useState } from 'react';
import Image from 'next/image';
import { Loader } from 'lucide-react';

import { calculateDistance } from '@/lib/haversine';
import { useGameState } from '@/hooks/useGameState';
import { GameSession } from '@/types/game';

import { MapComponent } from './Map';
```

## Error Handling

**Patterns:**

1. **Validation Errors:** Use descriptive error messages with context
   ```typescript
   if (!isValidCoordinate(lat, lng)) {
     throw new Error(`Invalid coordinates: lat=${lat}, lng=${lng}`);
   }
   ```

2. **API Errors:** Standardize error responses
   ```typescript
   // src/lib/apiError.ts
   export class APIError extends Error {
     constructor(
       public statusCode: number,
       message: string,
       public details?: unknown
     ) {
       super(message);
       this.name = 'APIError';
     }
   }

   // Usage in API routes
   if (!params.lat) {
     throw new APIError(400, 'Missing required parameter', { param: 'lat' });
   }
   ```

3. **Component Error Boundaries:** Use React Error Boundaries for component-level errors
   - Location: `src/components/ErrorBoundary.tsx`
   - Wrap feature sections (StreetView canvas, map, AI panel)

4. **Async Error Handling:** Use try-catch in async functions
   ```typescript
   try {
     const result = await validateStreetView(lat, lng);
   } catch (error) {
     if (error instanceof APIError) {
       logError('StreetView validation failed', error);
     }
     throw error;
   }
   ```

5. **Logging:** Console errors only in development; production uses structured logging
   ```typescript
   if (process.env.NODE_ENV === 'development') {
     console.error('Debug info:', details);
   }
   // Production: send to observability service
   logError('StreetView validation failed', { lat, lng, statusCode });
   ```

## Logging

**Framework:** `console` for development; use structured logging utility for production

**Utility Location:** `src/lib/logger.ts`

**Patterns:**
- Use `logInfo()`, `logWarn()`, `logError()` from logger utility
- Include context in log messages
- Avoid logging sensitive data (API keys, user coordinates, etc.)

**Example:**
```typescript
import { logInfo, logError } from '@/lib/logger';

logInfo('Location generated', { lat, lng, source: 'random' });
logError('Street View validation failed', { statusCode, reason });
```

## Comments

**When to Comment:**
- Complex algorithmic logic (e.g., Haversine formula implementation)
- Non-obvious workarounds or hacks (should include issue tracking reference)
- Business logic rationale (e.g., "AI assistance disabled for this mode per UX spec")
- External API quirks or limitations

**When NOT to Comment:**
- Self-explanatory code (good naming eliminates need)
- Obvious variable assignments
- Simple loop iterations

**JSDoc/TSDoc:**
- Use TSDoc comments for:
  - All exported functions
  - All public methods
  - Complex types/interfaces
  - React component props

**Example:**
```typescript
/**
 * Calculates distance between two geographic coordinates using the Haversine formula.
 * @param lat1 - First latitude in degrees (-90 to 90)
 * @param lng1 - First longitude in degrees (-180 to 180)
 * @param lat2 - Second latitude in degrees
 * @param lng2 - Second longitude in degrees
 * @returns Distance in kilometers
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  // Implementation
}
```

## Function Design

**Size:**
- Keep functions under 50 lines when possible
- If a function exceeds 100 lines, consider breaking it into smaller functions
- React components with complex rendering: extract sub-components instead of long JSX

**Parameters:**
- Maximum 3 positional parameters; use object parameter for more
- Optional parameters should be grouped in options object
- Example: `function generateLocation(options: { country?: string; theme?: string })`

**Return Values:**
- Explicit return types on all functions
- For optional returns, use `T | null` or `T | undefined` (prefer `null` for absence)
- For error cases, throw or use Result type pattern:
  ```typescript
  type Result<T> = { success: true; data: T } | { success: false; error: string };
  ```

**React Component Props:**
- Always create a `Props` interface for component parameters
- Pattern: `interface {ComponentName}Props`
- Keep props focused; prefer composition over prop drilling
- Example:
  ```typescript
  interface StreetViewCanvasProps {
    lat: number;
    lng: number;
    onReady?: () => void;
    onError?: (error: Error) => void;
  }

  export function StreetViewCanvas({ lat, lng, onReady, onError }: StreetViewCanvasProps) {
    // Implementation
  }
  ```

## Module Design

**Exports:**
- Use named exports for functions, types, and components
- Avoid default exports except for page components
- Pattern:
  ```typescript
  // Good
  export { StreetViewCanvas };
  export { useGameState };
  export type { GameState };

  // Avoid (unless page component)
  export default function StreetViewCanvas() {}
  ```

**Barrel Files:**
- Use `index.ts` in feature directories for convenient re-exports
- Pattern: `src/components/index.ts` re-exports all components
- Keep barrel files clean and organized:
  ```typescript
  // src/components/index.ts
  export { StreetViewCanvas } from './StreetViewCanvas';
  export { GuessMap } from './GuessMap';
  export { AIAssistantPanel } from './AIAssistantPanel';
  export type { StreetViewCanvasProps } from './StreetViewCanvas';
  ```

**Feature Organization:**
- Group related code by feature, not by type
- Structure: `src/features/{featureName}/{components,hooks,utils,types,api}`
- Example:
  ```
  src/features/game/
  ├── components/
  │   ├── StreetViewCanvas.tsx
  │   └── GuessMap.tsx
  ├── hooks/
  │   ├── useGameState.ts
  │   └── useStreetViewLoader.ts
  ├── utils/
  │   └── scoreCalculation.ts
  ├── types/
  │   └── game.ts
  └── api/
      └── endpoints.ts
  ```

---

*Convention analysis: 2026-02-24*
