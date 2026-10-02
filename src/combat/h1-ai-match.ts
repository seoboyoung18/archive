import { attackPhase, COMBAT_NEUTRAL, type CombatInput, type CombatState } from './combat.ts';
import { createH1Ai, clearH1AiInput, stepH1Ai, type H1AiFighter, type H1AiState, type H1AiObservation } from './h1-ai.ts';
import { stepMatch, type MatchState } from './match.ts';

/** Excludes health, stun timers, input buffers, hit history and future commands. */
export function observeH1Ai(combat: CombatState, side: 0 | 1): H1AiObservation {
  const visible = (i: 0 | 1): H1AiFighter => {
    const f = combat.fighters[i];
    return { x: f.x, y: f.y, facing: f.facing, grounded: f.grounded, posture: f.posture,
      action: f.action, state: f.state, walkDirection: f.walkDirection,
      attack: f.attack ? { key: f.attack.key, phase: attackPhase(f, combat.definitions[i]) } : null };
  };
  const opponent = side === 0 ? 1 : 0;
  return { self: visible(side), opponent: visible(opponent),
    selfDefinition: combat.definitions[side], opponentDefinition: combat.definitions[opponent] };
}

/** Used for both UI commands and tick results so lifecycle rules have one owner. */
export function transitionH1Ai(ai: H1AiState, previous: MatchState, next: MatchState): H1AiState {
  if (previous === next) return ai;
  if ((next.combat !== previous.combat && next.combat.frame === 0)
    || (previous.phase === 'ready' && next.phase === 'playing')) return createH1Ai();
  if (previous.paused !== next.paused || previous.phase !== next.phase) return clearH1AiInput(ai);
  if (next.combat.fighters[1].action === 'grab') return clearH1AiInput(ai);
  return ai;
}

export function stepH1AiMatch(match: MatchState, ai: H1AiState, player: CombatInput): { match: MatchState; ai: H1AiState } {
  if (match.phase !== 'playing' || match.paused) {
    return { match: stepMatch(match, [COMBAT_NEUTRAL, COMBAT_NEUTRAL]), ai };
  }
  const choice = stepH1Ai(ai, () => observeH1Ai(match.combat, 1), match.combat.fighters[1].action === 'grab');
  const next = stepMatch(match, [player, choice.input]);
  return { match: next, ai: transitionH1Ai(choice.ai, match, next) };
}
