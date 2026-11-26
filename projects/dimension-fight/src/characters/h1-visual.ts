import { grabPoseState, type CombatFighter, type CombatState } from '../combat/combat.ts';
import type { CharacterDefinition } from '../combat/definition.ts';
import { STAGE } from '../combat/movement.ts';
import { flipProgress, isFreeFlip } from './h1-jump.ts';

export interface CombatVisual {
  x: number; y: number; angle: number; originY: number; depth: number; labelHeight: number;
}
/** World-space pose/throw presentation. Shared camera framing never moves individual sprites. */
export function combatVisual(f: CombatFighter, def: CharacterDefinition, _koFrame = 0): CombatVisual {
  const g = grabPoseState(f);
  const result = { x: f.x, y: f.action === 'ko' ? STAGE.floor : f.y, angle: 0,
    originY: 0.875, depth: f.id as number, labelHeight: f.action === 'ko' ? 125 : f.posture === 'crouch' ? 162 : 255 };
  if (isFreeFlip(f)) {
    result.originY = 0.5;
    result.y -= 120;
    result.angle = f.facing * 360 * flipProgress(f, def);
    result.labelHeight = 135;
  }
  if (g?.kind !== 'success') return result;
  const impact = g.impactAt ?? def.grab!.impact, turn = (g.techUntil ?? def.grab!.techWindow) + 1;
  const lift = Math.min(impact, turn + Math.max(1, Math.floor((impact - turn) / 3)));
  if (g.role === 'attacker') {
    result.depth = g.age < lift ? 3 : 1;
    return result;
  }
  result.depth = g.age >= lift ? 4 : 2;
  if (g.age >= impact) {
    const recovery = Math.max(1, g.releaseAt - impact);
    result.labelHeight = f.action === 'ko' || g.age < impact + recovery / 3 ? 105
      : g.age < impact + recovery * 2 / 3 ? 170 : f.posture === 'crouch' ? 162 : 255;
    return result;
  }
  if (g.age < turn) return result;
  const progress = (g.age - turn) / (impact - turn);
  // A landing advances the logical root by 48; the airborne drawing approaches it smoothly.
  const push = g.pushDistance ?? def.grab!.push;
  const landingX = Math.max(STAGE.minX, Math.min(STAGE.maxX, f.x - f.facing * push));
  result.x += f.facing * 32 * Math.sin(Math.PI * progress) + (landingX - f.x) * progress * progress;
  result.y -= 70 * Math.sin(Math.PI * progress);
  if (g.age < lift) result.angle = f.facing * 20 * (g.age - turn) / Math.max(1, lift - turn);
  else {
    const flight = (g.age - lift) / Math.max(1, impact - lift);
    // Rotate around the airborne body's center, not around its former feet.
    result.originY = 0.5;
    result.y -= 120 - 60 * flight;
    result.angle = f.facing * (-45 + 120 * flight);
    result.labelHeight = 130;
  }
  return result;
}

export function combatVisuals(combat: Pick<CombatState, 'fighters' | 'definitions'>, koFrame = 0): [CombatVisual, CombatVisual] {
  return [combatVisual(combat.fighters[0], combat.definitions[0], koFrame),
    combatVisual(combat.fighters[1], combat.definitions[1], koFrame)];
}
