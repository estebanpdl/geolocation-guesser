'use client';

import { useReducer, useCallback, useRef, useEffect } from 'react';
import type { GameSession, Coordinate, Hypothesis, Guess, RoundResult } from '@/lib/types';
import { haversineDistance, getAccuracyCategory, calculateScore } from '@/lib/distance';

type GameAction =
  | { type: 'START_SESSION'; playerName: string; totalRounds: number }
  | { type: 'SET_LOCATION'; location: Coordinate }
  | { type: 'UPDATE_HYPOTHESIS'; hypothesis: Hypothesis }
  | { type: 'SUBMIT_GUESS'; guess: Guess }
  | { type: 'REVEAL_RESULT' }
  | { type: 'NEXT_ROUND' }
  | { type: 'MARK_AI_USED' }
  | { type: 'COMPLETE_SESSION' };

function generateId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function createInitialState(): GameSession {
  return {
    id: '',
    playerName: '',
    locationSetId: 'random',
    totalRounds: 5,
    currentRound: 0,
    phase: 'idle',
    rounds: [],
    currentLocation: null,
    currentHypothesis: null,
    currentGuess: null,
    aiUsedCurrentRound: false,
    startedAt: 0,
    completedAt: null,
  };
}

async function fetchLocation(usedLocations: Coordinate[]): Promise<Coordinate> {
  try {
    const res = await fetch('/api/generate-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usedLocations }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.coordinate;
    }
  } catch {
    // API unavailable
  }
  return { lat: 48.8566, lng: 2.3522 };
}

function gameReducer(state: GameSession, action: GameAction): GameSession {
  switch (action.type) {
    case 'START_SESSION':
      return {
        ...state,
        id: generateId(),
        playerName: action.playerName,
        locationSetId: 'random',
        totalRounds: action.totalRounds,
        currentRound: 1,
        phase: 'playing',
        rounds: [],
        currentLocation: null,
        currentHypothesis: null,
        currentGuess: null,
        aiUsedCurrentRound: false,
        startedAt: Date.now(),
        completedAt: null,
      };

    case 'SET_LOCATION':
      return { ...state, currentLocation: action.location };

    case 'UPDATE_HYPOTHESIS':
      return { ...state, currentHypothesis: action.hypothesis };

    case 'SUBMIT_GUESS':
      return { ...state, currentGuess: action.guess, phase: 'guessed' };

    case 'REVEAL_RESULT': {
      if (!state.currentLocation || !state.currentGuess) return state;
      const distanceKm = haversineDistance(state.currentGuess.position, state.currentLocation);
      const score = calculateScore(distanceKm);
      const category = getAccuracyCategory(distanceKm);
      const roundResult: RoundResult = {
        roundNumber: state.currentRound,
        actual: state.currentLocation,
        guess: state.currentGuess.position,
        distanceKm, score, category,
        hypothesis: state.currentHypothesis,
        usedAI: state.aiUsedCurrentRound,
        timestamp: Date.now(),
      };
      return { ...state, rounds: [...state.rounds, roundResult], phase: 'revealed' };
    }

    case 'NEXT_ROUND':
      return {
        ...state,
        currentRound: state.currentRound + 1,
        phase: 'playing',
        currentLocation: null,
        currentHypothesis: null,
        currentGuess: null,
        aiUsedCurrentRound: false,
      };

    case 'MARK_AI_USED':
      return { ...state, aiUsedCurrentRound: true };

    case 'COMPLETE_SESSION':
      return { ...state, phase: 'complete', completedAt: Date.now() };

    default:
      return state;
  }
}

export function useGameSession() {
  const [session, dispatch] = useReducer(gameReducer, createInitialState());

  const transitioningRef = useRef(false);
  const usedLocationsRef = useRef<Coordinate[]>([]);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const setLocation = useCallback((location: Coordinate) => {
    dispatch({ type: 'SET_LOCATION', location });
  }, []);

  const startSession = useCallback(
    async (playerName: string, totalRounds: number) => {
      usedLocationsRef.current = [];
      retryCountRef.current = 0;

      dispatch({ type: 'START_SESSION', playerName, totalRounds });

      const location = await fetchLocation([]);
      usedLocationsRef.current.push(location);
      dispatch({ type: 'SET_LOCATION', location });
    },
    []
  );

  const updateHypothesis = useCallback((hypothesis: Hypothesis) => {
    dispatch({ type: 'UPDATE_HYPOTHESIS', hypothesis });
  }, []);

  const submitGuess = useCallback((position: Coordinate) => {
    dispatch({ type: 'SUBMIT_GUESS', guess: { position, timestamp: Date.now() } });
  }, []);

  const revealResult = useCallback(() => {
    dispatch({ type: 'REVEAL_RESULT' });
  }, []);

  const nextRound = useCallback(async () => {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    retryCountRef.current = 0;

    try {
      dispatch({ type: 'NEXT_ROUND' });

      const location = await fetchLocation(usedLocationsRef.current);
      usedLocationsRef.current.push(location);

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          dispatch({ type: 'SET_LOCATION', location });
          resolve();
        }, 0);
      });
    } finally {
      transitioningRef.current = false;
    }
  }, []);

  const completeSession = useCallback(() => {
    dispatch({ type: 'COMPLETE_SESSION' });
  }, []);

  const markAIUsed = useCallback(() => {
    dispatch({ type: 'MARK_AI_USED' });
  }, []);

  /** Called when StreetViewCanvas can't load a panorama — fetch a replacement. */
  const retryCountRef = useRef(0);
  const MAX_RETRIES_PER_ROUND = 1;

  const retryLocation = useCallback(async () => {
    if (sessionRef.current.phase !== 'playing') return;
    if (retryCountRef.current >= MAX_RETRIES_PER_ROUND) return;
    retryCountRef.current++;

    // Delay to avoid hammering Google's API
    await new Promise((r) => setTimeout(r, 1500));
    if (sessionRef.current.phase !== 'playing') return;

    const location = await fetchLocation(usedLocationsRef.current);
    usedLocationsRef.current.push(location);
    dispatch({ type: 'SET_LOCATION', location });
  }, []);

  const totalScore = session.rounds.reduce((sum, r) => sum + r.score, 0);

  useEffect(() => {
    if (session.phase === 'complete' && session.id) {
      import('@/lib/session-storage').then(({ saveSession }) => {
        saveSession(session);
      });
    }
  }, [session.phase, session.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    session, startSession, setLocation, updateHypothesis,
    submitGuess, revealResult, nextRound, completeSession,
    markAIUsed, retryLocation, totalScore,
  };
}
