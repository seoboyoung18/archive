import type { CombatFighter } from '../combat/combat.ts';
import type { CharacterDefinition } from '../combat/definition.ts';

export function isFreeFlip(f: CombatFighter): boolean {
  return f.action === 'free' && f.state === 'jump' && !f.grounded && !f.jumpInterrupted && !f.grabSnapshot;
}

/** Ballistic progress keeps a full turn tied to the existing jump, independent of render rate. */
export function flipProgress(f: CombatFighter, definition: CharacterDefinition): number {
  const launch = definition.movement.jumpSpeed;
  return Math.max(0, Math.min(1, (f.vy - launch) / (-2 * launch)));
}
