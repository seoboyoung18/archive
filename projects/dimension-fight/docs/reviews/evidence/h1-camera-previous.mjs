// Frozen pre-camera display from git 3fe3f23; comparison evidence only.
// TypeScript types were stripped without changing runtime expressions. Bounds are frozen below.
// h1-visual.ts SHA256 b7a4e2647676bdf2f7b7208b623c57146163021935e1b66befc12eb287242c0b
// h1-visual-bounds.ts SHA256 1f5e2f1d3461aa8683b16194b099798490c884a72c1f7545df6c7a42b13cf604
import { grabPoseState } from '../../../src/combat/combat.ts';
import { STAGE } from '../../../src/combat/movement.ts';
import { combatPose } from '../../../src/characters/h1-poses.ts';

// Generated from alpha > 0 PNG pixel cells; right edges are exclusive.
// Historical generator at git 3fe3f23: scripts/generate-h1-visual-bounds.mjs (removed from current product).
// Idle frames share their union to keep the displayed root steady.
export const H1_VISUAL_BOUNDS                                                      = {
  'idle-0': [105, 414],
  'idle-1': [105, 414],
  'crouch': [155, 368],
  'stand-guard': [77, 416],
  'crouch-guard': [72, 369],
  'stand-hit': [53, 416],
  'crouch-hit': [113, 379],
  'ko-0': [74, 422],
  'ko-1': [47, 466],
  'ko-2': [49, 466],
  'grab-ready': [105, 413],
  'grab-reach': [94, 454],
  'grab-retract': [106, 413],
  'grab-settle': [105, 413],
  'grab-release': [105, 416],
  'grab-stand-hold': [103, 464],
  'grab-crouch-hold': [77, 463],
  'grabbed-stand-hold': [104, 416],
  'grabbed-crouch-hold': [77, 370],
  'grabbed-stand-recover': [77, 421],
  'grabbed-crouch-recover': [74, 370],
  'grabbed-stand-escape': [104, 459],
  'grabbed-crouch-escape': [113, 443],
  'throw-turn': [63, 422],
  'throw-lift': [66, 442],
  'throw-slam': [77, 451],
  'thrown-air': [74, 404],
  'thrown-down': [46, 467],
  'thrown-rise': [77, 424],
};

// Convex hulls preserve the exact horizontal projection after rotation and reflection.
export const H1_VISUAL_HULLS                                                                   = {
  'grabbed-stand-hold': [
    [104, 439],
    [113, 177],
    [247, 69],
    [250, 67],
    [256, 64],
    [260, 63],
    [272, 63],
    [276, 64],
    [282, 66],
    [288, 69],
    [291, 71],
    [299, 77],
    [301, 79],
    [304, 83],
    [359, 164],
    [364, 172],
    [365, 174],
    [366, 177],
    [416, 434],
    [416, 440],
    [410, 446],
    [123, 450],
    [122, 450],
    [107, 447],
    [104, 444],
  ],
  'grabbed-crouch-hold': [
    [77, 76],
    [270, 58],
    [271, 58],
    [370, 323],
    [370, 330],
    [369, 361],
    [359, 439],
    [356, 442],
    [352, 444],
    [348, 445],
    [341, 446],
    [325, 447],
    [186, 448],
    [162, 448],
    [159, 447],
    [155, 443],
    [77, 77],
  ],
  'thrown-air': [
    [74, 443],
    [118, 227],
    [121, 213],
    [127, 206],
    [277, 107],
    [307, 92],
    [312, 90],
    [315, 89],
    [319, 88],
    [329, 88],
    [332, 89],
    [335, 91],
    [375, 121],
    [378, 124],
    [379, 126],
    [392, 195],
    [404, 296],
    [404, 297],
    [394, 377],
    [368, 438],
    [255, 445],
    [254, 445],
    [74, 444],
  ],
};








/** Original pose/throw presentation, before any horizontal boundary correction. */
function baseVisual(f               , def                     )               {
  const g = grabPoseState(f);
  const result = { x: f.x, y: f.action === 'ko' ? STAGE.floor : f.y, angle: 0,
    originY: 0.875, depth: f.id          , labelHeight: f.action === 'ko' ? 125 : f.posture === 'crouch' ? 162 : 255 };
  if (g?.kind !== 'success') return result;
  const impact = g.impactAt ?? def.grab .impact, turn = (g.techUntil ?? def.grab .techWindow) + 1;
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
  const push = g.pushDistance ?? def.grab .push;
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

function horizontalBounds(f               , visual              , pose        )                          {
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

const correction = ([left, right]                  ) => Math.max(-left, Math.min(1280 - right, 0));

function sharesLockedRelation(a               , b               )          {
  // Result snapshots remain paired; never combine a snapshot with an unrelated live action.
  if (Boolean(a.grabSnapshot) !== Boolean(b.grabSnapshot)) return false;
  const first = grabPoseState(a), second = grabPoseState(b);
  if (!first || !second || first.kind !== second.kind || first.kind === 'attempt' || first.role === second.role) return false;
  const ownerA = first.role === 'attacker' ? a.id : b.id, ownerB = second.role === 'attacker' ? b.id : a.id;
  return ownerA === ownerB && first.serial === second.serial && first.age === second.age
    && first.age < first.releaseAt && second.age < second.releaseAt;
}

/** Single-fighter inspection API; shared combat renderers use combatVisuals instead. */
export function combatVisual(f               , def                     , koFrame = 0)               {
  const visual = baseVisual(f, def), bounds = horizontalBounds(f, visual, combatPose(f, def, koFrame));
  if (bounds) visual.x += correction(bounds);
  return visual;
}

/** Only display x changes. A shared translation preserves the locked pair's relative pose. */
export function combatVisuals(combat                                               , koFrame = 0)                               {
  const [a, b] = combat.fighters, [defA, defB] = combat.definitions;
  const visuals                               = [baseVisual(a, defA), baseVisual(b, defB)];
  const bounds = [horizontalBounds(a, visuals[0], combatPose(a, defA, koFrame)),
    horizontalBounds(b, visuals[1], combatPose(b, defB, koFrame))];
  if (bounds[0] && bounds[1] && sharesLockedRelation(a, b)) {
    const dx = correction([Math.min(bounds[0][0], bounds[1][0]), Math.max(bounds[0][1], bounds[1][1])]);
    visuals[0].x += dx; visuals[1].x += dx;
  } else {
    for (const i of [0, 1]         ) if (bounds[i]) visuals[i].x += correction(bounds[i] );
  }
  return visuals;
}
