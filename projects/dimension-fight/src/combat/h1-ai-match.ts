import { attackPhase, COMBAT_NEUTRAL, type CombatInput, type CombatState } from './combat.ts';
import { createH1Ai, clearH1AiInput, stepH1Ai, type H1AiFighter, type H1AiState, type H1AiObservation, type H1AiGrab } from './h1-ai.ts';
import { stepMatch, type MatchState } from './match.ts';

/** The pair's current presentation phase, not the target sprite (which holds through H19). */
function visibleGrab(combat: CombatState, side: 0 | 1): H1AiGrab | null {
  const grab = combat.fighters[side].grab;
  if (!grab) return null;
  const owner = grab.role === 'attacker' ? side : side === 0 ? 1 : 0;
  const rules = combat.definitions[owner].grab;
  const phase = grab.kind !== 'success' ? grab.kind
    : grab.age <= rules!.techWindow ? 'hold' : grab.age < rules!.impact ? 'throw' : 'down';
  return { kind: grab.kind, role: grab.role, phase, owner, serial: grab.serial };
}

/** Excludes health, exact action ages/stun timers, hand buffers and future commands. */
export function observeH1Ai(combat: CombatState, side: 0 | 1): H1AiObservation {
  const visible = (i: 0 | 1): H1AiFighter => {
    const f = combat.fighters[i];
    return { x: f.x, y: f.y, facing: f.facing, grounded: f.grounded, posture: f.posture,
      action: f.action, state: f.state, walkDirection: f.walkDirection,
      attack: f.attack ? { key: f.attack.key, phase: attackPhase(f, combat.definitions[i]) } : null,
      grab: visibleGrab(combat, i) };
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
  // Only the CPU's own lock eligibility is checked between decisions. Full observation stays lazy.
  const ownGrab = visibleGrab(match.combat, 1);
  const canConsiderEscape = ownGrab?.kind === 'success' && ownGrab.role === 'target' && ownGrab.phase === 'hold';
  const locked = match.combat.fighters[1].action === 'grab' && !canConsiderEscape;
  const choice = stepH1Ai(ai, () => observeH1Ai(match.combat, 1), locked);
  const next = stepMatch(match, [player, choice.input]);
  return { match: next, ai: transitionH1Ai(choice.ai, match, next) };
}
