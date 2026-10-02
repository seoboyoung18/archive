import { createCombat, stepCombat, type CombatInput, type CombatState } from './combat.ts';
import type { CharacterDefinition } from './definition.ts';

export const ROUND_FRAMES = 60 * 60;
export const KO_FRAMES = 18;
export type MatchPhase = 'ready' | 'playing' | 'round-result' | 'match-result';
export interface RoundResult {
  reason: 'ko' | 'double-ko' | 'timeout' | 'timeout-tie';
  winner: 0 | 1 | null;
}
export interface MatchState {
  combat: CombatState;
  phase: MatchPhase;
  paused: boolean;
  round: number;
  wins: [number, number];
  remainingFrames: number;
  result: RoundResult | null;
  resultAge: number;
}

export function createMatch(definitions?: readonly [CharacterDefinition, CharacterDefinition]): MatchState {
  return { combat: createCombat(definitions), phase: 'ready', paused: false, round: 1,
    wins: [0, 0], remainingFrames: ROUND_FRAMES, result: null, resultAge: 0 };
}
export function secondsRemaining(s: MatchState): number { return Math.ceil(s.remainingFrames / 60); }
export function resultReady(s: MatchState): boolean {
  return !s.paused && s.result !== null &&
    (s.result.reason === 'timeout' || s.result.reason === 'timeout-tie' || s.resultAge >= KO_FRAMES);
}
export function startMatch(s: MatchState): MatchState {
  return s.phase === 'ready' && !s.paused ? { ...s, phase: 'playing' } : s;
}
export function pauseMatch(s: MatchState, paused: boolean): MatchState {
  return s.phase === 'ready' || s.paused === paused ? s : { ...s, paused };
}
export function nextRound(s: MatchState): MatchState {
  if (s.phase !== 'round-result' || !resultReady(s)) return s;
  return { ...createMatch(s.combat.definitions), phase: 'playing', wins: [...s.wins],
    round: s.round + (s.result!.winner === null ? 0 : 1) };
}
export function restartMatch(s: MatchState): MatchState {
  return s.phase === 'match-result' && resultReady(s) ? createMatch(s.combat.definitions) : s;
}

/** Exactly one 60Hz tick. Results stop combat even when CombatState.ended is false (timeout). */
export function stepMatch(s: MatchState, inputs: readonly [CombatInput, CombatInput]): MatchState {
  if (s.paused || s.phase === 'ready') return s;
  if (s.phase !== 'playing') {
    return !resultReady(s) ? { ...s, resultAge: Math.min(KO_FRAMES, s.resultAge + 1) } : s;
  }
  const combat = stepCombat(s.combat, inputs), remainingFrames = s.remainingFrames - 1;
  const [p, cpu] = combat.fighters;
  let result: RoundResult | null = null;
  if (p.hp === 0 && cpu.hp === 0) result = { reason: 'double-ko', winner: null };
  else if (p.hp === 0 || cpu.hp === 0) result = { reason: 'ko', winner: p.hp > 0 ? 0 : 1 };
  else if (remainingFrames === 0) result = p.hp === cpu.hp
    ? { reason: 'timeout-tie', winner: null }
    : { reason: 'timeout', winner: p.hp > cpu.hp ? 0 : 1 };
  if (!result) return { ...s, combat, remainingFrames };
  const wins: [number, number] = [...s.wins];
  if (result.winner !== null) wins[result.winner]++;
  return { ...s, combat, remainingFrames, wins, result, resultAge: 0,
    phase: wins.some(n => n === 2) ? 'match-result' : 'round-result' };
}
