import { grabPoseState, type CombatFighter } from '../combat/combat.ts';
import type { CharacterDefinition } from '../combat/definition.ts';
import { STAGE } from '../combat/movement.ts';
import { combatPose } from './h1-poses.ts';

// Alpha > 0 pixel-cell edges in the 512px source PNGs; right is exclusive.
// Tests compare the displayed extent with the actual PNG alpha after every asset change.
const reactionBounds: Record<string, readonly [number, number]> = {
  'stand-hit': [53, 416], 'crouch-hit': [113, 379],
  'ko-0': [74, 422], 'ko-1': [47, 466], 'ko-2': [49, 466],
};

/** Display-only transforms. Logical roots, facing and collision positions never move here. */
export function combatVisual(f: CombatFighter, def: CharacterDefinition, koFrame = 0) {
  const g = grabPoseState(f);
  const result = { x: f.x, y: f.action === 'ko' ? STAGE.floor : f.y, angle: 0,
    originY: 0.875, depth: f.id as number, labelHeight: f.action === 'ko' ? 125 : f.posture === 'crouch' ? 162 : 255 };
  if (g?.kind !== 'success') {
    if (f.action === 'hit' || f.action === 'ko') {
      const bounds = reactionBounds[combatPose(f, def, koFrame)];
      if (bounds) {
        const a = (bounds[0] - 256) * 0.625 * f.facing;
        const b = (bounds[1] - 256) * 0.625 * f.facing;
        result.x = Math.max(-Math.min(a, b), Math.min(1280 - Math.max(a, b), result.x));
      }
    }
    return result;
  }
  const impact = g.impactAt ?? def.grab!.impact, turn = (g.techUntil ?? def.grab!.techWindow) + 1;
  const lift = Math.min(impact, turn + Math.max(1, Math.floor((impact - turn) / 3)));
  if (g.role === 'attacker') {
    result.depth = g.age < lift ? 3 : 1;
    return result;
  }
  result.depth = g.age >= lift ? 4 : 2;
  // The adopted throw silhouettes extend at most 134px from their displayed center.
  // Keep their body visible at arena edges without changing the collision/landing root.
  const keepBodyOnStage = () => { result.x = Math.max(136, Math.min(1280 - 136, result.x)); };
  if (g.age >= impact) {
    const recovery = Math.max(1, g.releaseAt - impact);
    result.labelHeight = f.action === 'ko' || g.age < impact + recovery / 3 ? 105
      : g.age < impact + recovery * 2 / 3 ? 170 : f.posture === 'crouch' ? 162 : 255;
    keepBodyOnStage();
    if (f.action !== 'ko' && g.age >= impact + recovery / 3) {
      const upright = (g.age - impact - recovery / 3) / (recovery * 2 / 3);
      result.x += (f.x - result.x) * upright;
    }
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
    keepBodyOnStage();
  }
  return result;
}
