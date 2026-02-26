export interface Coordinate {
  lat: number;
  lng: number;
}

export interface Hypothesis {
  country: string;
  city: string;
  landmark: string;
  confidence: number; // 1-5
  evidenceNotes: string;
}

export interface Guess {
  position: Coordinate;
  timestamp: number;
}

export type AccuracyCategory = 'Excellent' | 'Good' | 'Fair' | 'Poor';

export interface RoundResult {
  roundNumber: number;
  actual: Coordinate;
  guess: Coordinate;
  distanceKm: number;
  score: number;
  category: AccuracyCategory;
  hypothesis: Hypothesis | null;
  usedAI: boolean;
  timestamp: number;
}

export type GamePhase = 'idle' | 'playing' | 'guessed' | 'revealed' | 'complete';

export interface GameSession {
  id: string;
  playerName: string;
  locationSetId: string;
  totalRounds: number;
  currentRound: number;
  phase: GamePhase;
  rounds: RoundResult[];
  currentLocation: Coordinate | null;
  currentGuess: Guess | null;
  aiUsedCurrentRound: boolean;
  startedAt: number;
  completedAt: number | null;
}

export interface LocationSet {
  id: string;
  name: string;
  description: string;
  locations: Coordinate[];
}
