# Testing Patterns

**Analysis Date:** 2026-02-24

## Project Context

This document establishes testing patterns for the OSINT Geolocation Training Platform. As the codebase is in pre-implementation phase, these patterns are prescriptive and will guide all test development.

## Test Framework

**Runner:**
- Vitest (recommended over Jest for Next.js projects with ESM support)
- Config location: `vitest.config.ts` in project root

**Assertion Library:**
- `vitest` built-in expect API
- `@testing-library/react` for component testing
- `@testing-library/jest-dom` for DOM matchers

**Run Commands:**
```bash
npm run test              # Run all tests once
npm run test:watch       # Watch mode for development
npm run test:coverage    # Generate coverage report
npm run test:ui          # Vitest UI (optional)
```

**Configuration (vitest.config.ts):**
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

## Test File Organization

**Location:**
- Co-located with source files (same directory as component/utility being tested)
- Pattern: `ComponentName.test.tsx` next to `ComponentName.tsx`

**Naming:**
- Suffix: `.test.ts` or `.test.tsx` (for TypeScript/React)
- Alternatively: `.spec.ts` or `.spec.tsx`
- Consistency: Use `.test.` across entire codebase

**Structure:**
```
src/
├── components/
│   ├── StreetViewCanvas.tsx
│   ├── StreetViewCanvas.test.tsx
│   ├── GuessMap.tsx
│   └── GuessMap.test.tsx
├── hooks/
│   ├── useGameState.ts
│   └── useGameState.test.ts
├── lib/
│   ├── haversine.ts
│   └── haversine.test.ts
└── api/
    ├── score.ts
    └── score.test.ts
```

## Test Structure

**Suite Organization:**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StreetViewCanvas } from './StreetViewCanvas';

describe('StreetViewCanvas', () => {
  beforeEach(() => {
    // Setup shared test state
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Cleanup
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('should render with valid coordinates', () => {
      // Test implementation
    });

    it('should show loading state while loading panorama', () => {
      // Test implementation
    });
  });

  describe('user interactions', () => {
    it('should call onReady callback when panorama loads', async () => {
      // Test implementation
    });
  });

  describe('error handling', () => {
    it('should call onError callback when Street View is unavailable', async () => {
      // Test implementation
    });
  });
});
```

**Patterns:**
- Use `describe()` for logical grouping (component feature areas)
- One `it()` per behavior/assertion
- Descriptive test names: "should [behavior] when [condition]"
- Use `beforeEach()` for common setup (mocking APIs, creating fixtures)
- Use `afterEach()` for cleanup (restore mocks, clear state)

## Mocking

**Framework:** Vitest native mocking with `vi` module

**Patterns:**

1. **Module Mocking (External APIs):**
   ```typescript
   // Mock Google Maps API
   vi.mock('@/lib/googleMapsLoader', () => ({
     initStreetView: vi.fn(),
     validateLocation: vi.fn(),
   }));

   import { validateLocation } from '@/lib/googleMapsLoader';

   describe('StreetViewCanvas', () => {
     it('should validate location on mount', async () => {
       vi.mocked(validateLocation).mockResolvedValue(true);

       // Test code

       expect(validateLocation).toHaveBeenCalledWith({
         lat: 40.7128,
         lng: -74.006,
       });
     });
   });
   ```

2. **Component Mocking (For Integration Tests):**
   ```typescript
   vi.mock('./GoogleStreetViewComponent', () => ({
     GoogleStreetView: ({ onLoad }: any) => (
       <div data-testid="mock-streetview" onClick={onLoad}>
         Mock Street View
       </div>
     ),
   }));
   ```

3. **Function Mocking (Utilities):**
   ```typescript
   import { haversineDistance } from '@/lib/haversine';

   vi.mock('@/lib/haversine');

   it('should use distance for scoring', () => {
     vi.mocked(haversineDistance).mockReturnValue(5.23);

     // Test code expects distance calculation
   });
   ```

4. **Partial Mocking (Keep Some Functions Real):**
   ```typescript
   vi.mock('@/lib/validation', async (importOriginal) => {
     const actual = await importOriginal<typeof import('@/lib/validation')>();
     return {
       ...actual,
       isValidCoordinate: vi.fn(),
     };
   });
   ```

**What to Mock:**
- External APIs (Google Maps, OpenAI, Claude, etc.)
- HTTP requests (use MSW or direct fetch mocking)
- Browser APIs (localStorage, geolocation, etc.)
- Time-dependent functions (use `vi.useFakeTimers()`)

**What NOT to Mock:**
- Core business logic (distance calculation, scoring)
- Custom hooks (test them directly)
- Utility functions (test real behavior)
- Component rendering (test actual DOM when possible)

## Fixtures and Factories

**Test Data:**

Create a `tests/fixtures/` directory with factory functions:

```typescript
// tests/fixtures/game.ts
export function createMockGameState(overrides = {}) {
  return {
    sessionId: 'test-session-123',
    currentLocation: { lat: 40.7128, lng: -74.006 },
    userGuess: null,
    round: 1,
    score: 0,
    hypotheses: {
      country: 'United States',
      city: 'New York',
      landmark: 'Times Square',
      confidence: 4,
      evidence: 'Visible street signs in English',
    },
    ...overrides,
  };
}

export function createMockCoordinates(
  lat: number = 40.7128,
  lng: number = -74.006
) {
  return { lat, lng };
}

// tests/fixtures/api.ts
export function createMockStreetViewResponse(overrides = {}) {
  return {
    status: 'OK',
    location: { lat: 40.7128, lng: -74.006 },
    panoId: 'AftkXf-zN9x6-Eo1',
    copyright: '© Google',
    ...overrides,
  };
}
```

**Location:**
- `tests/fixtures/` directory
- Organized by domain: `game.ts`, `api.ts`, `coordinates.ts`

**Usage:**
```typescript
import { createMockGameState } from '@/tests/fixtures/game';

describe('GameSession', () => {
  it('should update score on correct guess', () => {
    const gameState = createMockGameState({
      score: 0,
      round: 1,
    });

    // Test with fixture
  });
});
```

## Coverage

**Requirements:**
- Minimum 70% statement coverage
- Minimum 60% branch coverage
- Core business logic (scoring, distance calculation): 90%+
- API handlers: 85%+

**View Coverage:**
```bash
npm run test:coverage
# Generates HTML report in coverage/index.html
```

**GitHub Actions Check:** CI runs coverage and fails if minimums not met

**Files to Exclude from Coverage:**
- Type definitions (`.d.ts`)
- Config files
- Mock implementations
- Test helpers

## Test Types

**Unit Tests:**
- **Scope:** Individual functions and utilities
- **Approach:** Test one behavior at a time
- **Example:** `haversineDistance.test.ts`
  ```typescript
  describe('haversineDistance', () => {
    it('should calculate distance between two points', () => {
      const distance = haversineDistance(40.7128, -74.006, 34.0522, -118.2437);
      expect(distance).toBeCloseTo(3944, 0); // NYC to LA ~3944 km
    });
  });
  ```

**Integration Tests:**
- **Scope:** Multiple components/modules working together
- **Approach:** Test feature flows, not just isolated functions
- **Example:** `GameSession.integration.test.ts`
  ```typescript
  describe('Game Session Flow', () => {
    it('should generate location, validate, and accept guess', async () => {
      const { rerender } = render(<GameApp />);

      // Wait for location generation
      await waitFor(() => {
        expect(screen.getByTestId('street-view')).toBeInTheDocument();
      });

      // User makes hypothesis
      await userEvent.type(screen.getByPlaceholderText('Country'), 'USA');

      // User places guess
      await userEvent.click(screen.getByTestId('map'));

      // Score is calculated
      await waitFor(() => {
        expect(screen.getByText(/Score:/)).toBeInTheDocument();
      });
    });
  });
  ```

**E2E Tests:**
- **Framework:** Playwright or Cypress (optional for MVP)
- **When to add:** Post-MVP, for user journey validation
- **Location:** `tests/e2e/` directory
- **Not required for initial release**

## Common Patterns

**Async Testing:**

```typescript
// Pattern 1: Using async/await
it('should load street view panorama', async () => {
  const { getByTestId } = render(<StreetViewCanvas lat={40.7128} lng={-74.006} />);

  await waitFor(() => {
    expect(getByTestId('panorama')).toHaveClass('loaded');
  });
});

// Pattern 2: Using findBy (built-in waitFor)
it('should display location info after loading', async () => {
  render(<StreetViewCanvas lat={40.7128} lng={-74.006} />);

  const info = await screen.findByText(/Times Square/);
  expect(info).toBeInTheDocument();
});

// Pattern 3: Mock promise resolution
it('should handle API response', async () => {
  vi.mocked(validateLocation).mockResolvedValueOnce({
    isValid: true,
    panoId: 'test-pano-id',
  });

  render(<StreetViewCanvas lat={40.7128} lng={-74.006} />);

  await waitFor(() => {
    expect(screen.getByTestId('success')).toBeInTheDocument();
  });
});
```

**Error Testing:**

```typescript
// Pattern 1: Expect error to throw
it('should throw on invalid coordinates', () => {
  expect(() => {
    haversineDistance(91, 0, 0, 0); // lat > 90 invalid
  }).toThrow('Invalid latitude');
});

// Pattern 2: Catch error from async function
it('should handle API error', async () => {
  vi.mocked(validateLocation).mockRejectedValueOnce(
    new Error('Street View not available')
  );

  const { getByTestId } = render(
    <StreetViewCanvas lat={40.7128} lng={-74.006} />
  );

  await waitFor(() => {
    expect(getByTestId('error-message')).toHaveTextContent(
      'Street View not available'
    );
  });
});

// Pattern 3: Error boundary testing
it('should catch component errors in boundary', () => {
  const { getByTestId } = render(
    <ErrorBoundary>
      <BrokenComponent />
    </ErrorBoundary>
  );

  expect(getByTestId('error-fallback')).toBeInTheDocument();
});
```

**Component Testing (React):**

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('GuessMap', () => {
  it('should call onGuess when map is clicked', async () => {
    const handleGuess = vi.fn();
    const user = userEvent.setup();

    render(<GuessMap onGuess={handleGuess} />);

    const mapElement = screen.getByTestId('map-container');
    await user.click(mapElement);

    expect(handleGuess).toHaveBeenCalled();
  });
});
```

---

*Testing analysis: 2026-02-24*
