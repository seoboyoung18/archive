import { grabPoseState, type CombatFighter, type CombatState } from '../combat/combat.ts';
import type { CharacterDefinition } from '../combat/definition.ts';
import { STAGE } from '../combat/movement.ts';
import { combatPose } from './h1-poses.ts';
import { H1_VISUAL_BOUNDS, H1_VISUAL_HULLS } from './h1-visual-bounds.ts';

export interface CombatVisual {
  x: number; y: number; angle: number; originY: number; depth: number; labelHeight: number;
}
type HorizontalBounds = readonly [number, number];

/** Original pose/throw presentation, before any horizontal boundary correction. */
function baseVisual(f: CombatFighter, def: CharacterDefinition): CombatVisual {
  const g = grabPoseState(f);
  const result = { x: f.x, y: f.action === 'ko' ? STAGE.floor : f.y, angle: 0,
    originY: 0.875, depth: f.id as number, labelHeight: f.action === 'ko' ? 125 : f.posture === 'crouch' ? 162 : 255 };
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

function horizontalBounds(f: CombatFighter, visual: CombatVisual, pose: string): HorizontalBounds | null {
  const bounds = H1_VISUAL_BOUNDS[pose];
  if (!bounds) return null;
  const hull = H1_VISUAL_HULLS[pose];
  if (hull && visual.angle !== 0) {
    const radians = visual.angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
    let left = Infinity, right = -Infinity;
    for (const [x, y] of hull) {
      const dx = (x - 256) * 0.625 * f.facing, dy = (y - 512 * visual.originY) * 0.625;
      const worldX = visual.x + dx * cos - dy * sin;
      left = Math.min(left, worldX); right = Math.max(right, worldX);
    }
    return [left, right];
  }
  const a = (bounds[0] - 256) * 0.625 * f.facing, b = (bounds[1] - 256) * 0.625 * f.facing;
  return [visual.x + Math.min(a, b), visual.x + Math.max(a, b)];
}

const correction = ([left, right]: HorizontalBounds) => Math.max(-left, Math.min(1280 - right, 0));

function sharesLockedRelation(a: CombatFighter, b: CombatFighter): boolean {
  // Result snapshots remain paired; never combine a snapshot with an unrelated live action.
  if (Boolean(a.grabSnapshot) !== Boolean(b.grabSnapshot)) return false;
  const first = grabPoseState(a), second = grabPoseState(b);
  if (!first || !second || first.kind !== second.kind || first.kind === 'attempt' || first.role === second.role) return false;
  const ownerA = first.role === 'attacker' ? a.id : b.id, ownerB = second.role === 'attacker' ? b.id : a.id;
  return ownerA === ownerB && first.serial === second.serial && first.age === second.age
    && first.age < first.releaseAt && second.age < second.releaseAt;
}

/** Single-fighter inspection API; shared combat renderers use combatVisuals instead. */
export function combatVisual(f: CombatFighter, def: CharacterDefinition, koFrame = 0): CombatVisual {
  const visual = baseVisual(f, def), bounds = horizontalBounds(f, visual, combatPose(f, def, koFrame));
  if (bounds) visual.x += correction(bounds);
  return visual;
}

/** Only display x changes. A shared translation preserves the locked pair's relative pose. */
export function combatVisuals(combat: Pick<CombatState, 'fighters' | 'definitions'>, koFrame = 0): [CombatVisual, CombatVisual] {
  const [a, b] = combat.fighters, [defA, defB] = combat.definitions;
  const visuals: [CombatVisual, CombatVisual] = [baseVisual(a, defA), baseVisual(b, defB)];
  const bounds = [horizontalBounds(a, visuals[0], combatPose(a, defA, koFrame)),
    horizontalBounds(b, visuals[1], combatPose(b, defB, koFrame))];
  if (bounds[0] && bounds[1] && sharesLockedRelation(a, b)) {
    const dx = correction([Math.min(bounds[0][0], bounds[1][0]), Math.max(bounds[0][1], bounds[1][1])]);
    visuals[0].x += dx; visuals[1].x += dx;
  } else {
    for (const i of [0, 1] as const) if (bounds[i]) visuals[i].x += correction(bounds[i]!);
  }
  return visuals;
}
