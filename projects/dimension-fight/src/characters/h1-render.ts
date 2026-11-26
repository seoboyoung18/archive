import type { CombatFighter, CombatState } from '../combat/combat.ts';
import { combatCamera, type CombatCamera } from './h1-camera.ts';
import { combatPose } from './h1-poses.ts';
import { combatVisuals, type CombatVisual } from './h1-visual.ts';

export interface CombatRender {
  fighters: CombatState['fighters'];
  visuals: [CombatVisual, CombatVisual];
  poses: [string, string];
  camera: CombatCamera;
}

function sameAction(a: CombatFighter, b: CombatFighter): boolean {
  return a.action === b.action && a.grounded === b.grounded && a.facing === b.facing
    && a.posture === b.posture && a.walkDirection === b.walkDirection
    && a.attack?.serial === b.attack?.serial && a.attack?.key === b.attack?.key
    && a.grab?.kind === b.grab?.kind && a.grab?.role === b.grab?.role && a.grab?.serial === b.grab?.serial
    && a.grabSnapshot === b.grabSnapshot;
}

/** At most one tick of presentation history; combat, artwork age and events remain current. */
export function sampleCombatRender(previous: CombatState | null, current: CombatState, alpha: number, koFrame = 0): CombatRender {
  const visuals = combatVisuals(current, koFrame);
  const poses: [string, string] = [combatPose(current.fighters[0], current.definitions[0], koFrame),
    combatPose(current.fighters[1], current.definitions[1], koFrame)];
  let fighters = current.fighters;
  const continuous = previous && previous.frame + 1 === current.frame && !previous.ended && !current.ended
    && !current.events.length && !current.grabEvents.length
    && current.fighters.every((f, i) => sameAction(previous.fighters[i]!, f));
  if (continuous) {
    const before = combatVisuals(previous, koFrame);
    if (before.every((v, i) => v.originY === visuals[i]!.originY)) {
      const t = Math.max(0, Math.min(1, alpha));
      const lerp = (a: number, b: number) => a + (b - a) * t;
      const sample = (i: 0 | 1): CombatFighter => ({ ...current.fighters[i],
        x: lerp(previous.fighters[i].x, current.fighters[i].x), y: lerp(previous.fighters[i].y, current.fighters[i].y) });
      fighters = [sample(0), sample(1)];
      for (const i of [0, 1] as const) {
        visuals[i].x = lerp(before[i].x, visuals[i].x); visuals[i].y = lerp(before[i].y, visuals[i].y);
        // Preserve the unwrapped full-turn angle; shortest-path rotation would reverse a flip.
        visuals[i].angle = lerp(before[i].angle, visuals[i].angle);
      }
    }
  }
  return { fighters, visuals, poses, camera: combatCamera({ fighters }) };
}
