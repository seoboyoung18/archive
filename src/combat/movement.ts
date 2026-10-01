export type Direction = -1 | 1;
export type MovementState = 'idle' | 'walk' | 'crouch' | 'jump';
export interface MoveInput { axis: -1 | 0 | 1; crouch: boolean; jump: boolean }
export interface MovementRules { speed: number; jumpSpeed: number; gravity: number }
export interface Fighter {
  x: number; y: number; vy: number; facing: Direction;
  state: MovementState; age: number; grounded: boolean;
  walkDirection: Direction;
}
export const H1_MOVEMENT: MovementRules = { speed: 240, jumpSpeed: -800, gravity: 2000 };
export const STAGE = { floor: 600, minX: 80, maxX: 1200, gap: 72 } as const;
export const NEUTRAL: MoveInput = { axis: 0, crouch: false, jump: false };
export const DT = 1 / 60;

export function createFighters(): [Fighter, Fighter] {
  return [
    { x: 400, y: 600, vy: 0, facing: 1, state: 'idle', age: 0, grounded: true, walkDirection: 1 },
    { x: 880, y: 600, vy: 0, facing: -1, state: 'idle', age: 0, grounded: true, walkDirection: -1 },
  ];
}

function advance(f: Fighter, input: MoveInput, rules: MovementRules): Fighter {
  const next = { ...f };
  let crouching = next.grounded && input.crouch;
  if (next.grounded && input.jump && !crouching) {
    next.grounded = false;
    next.vy = rules.jumpSpeed;
  }
  const dx = crouching ? 0 : input.axis * rules.speed * DT;
  next.x = Math.max(STAGE.minX, Math.min(STAGE.maxX, next.x + dx));
  if (!next.grounded) {
    next.y += next.vy * DT + 0.5 * rules.gravity * DT * DT;
    next.vy += rules.gravity * DT;
    if (next.y >= STAGE.floor - 1e-9 && next.vy >= 0) {
      next.y = STAGE.floor; next.vy = 0; next.grounded = true;
    }
  }
  crouching = next.grounded && input.crouch;
  next.state = !next.grounded ? 'jump' : crouching ? 'crouch' : input.axis ? 'walk' : 'idle';
  if (next.state === 'walk' && input.axis !== 0) next.walkDirection = input.axis;
  next.age = next.state === f.state ? f.age + 1 : 0;
  return next;
}

/** Both tentative moves are resolved together; vertical position never permits passing. */
export function stepMovement(
  fighters: readonly [Fighter, Fighter],
  inputs: readonly [MoveInput, MoveInput],
  rules: readonly [MovementRules, MovementRules] = [H1_MOVEMENT, H1_MOVEMENT],
): [Fighter, Fighter] {
  const next: [Fighter, Fighter] = [advance(fighters[0], inputs[0], rules[0]), advance(fighters[1], inputs[1], rules[1])];
  const leftIndex = fighters[0].x <= fighters[1].x ? 0 : 1;
  const left = next[leftIndex], right = next[1 - leftIndex]!;
  if (right.x - left.x < STAGE.gap) {
    const middle = (left.x + right.x) / 2;
    left.x = Math.max(STAGE.minX, Math.min(STAGE.maxX - STAGE.gap, middle - STAGE.gap / 2));
    right.x = left.x + STAGE.gap;
  }
  for (const index of [0, 1] as const) {
    // An airborne fighter keeps its takeoff orientation; grounded fighters face the opponent.
    if (next[index].grounded) next[index].facing = next[1 - index]!.x >= next[index].x ? 1 : -1;
  }
  return next;
}

export function movementPose(f: Fighter): string {
  if (f.state === 'crouch') return 'crouch';
  if (f.state === 'walk') return `walk-${Math.floor(f.age / 6) % 4}`;
  if (f.state === 'jump') return f.vy < -100 - 1e-9 ? 'jump-rise' : f.vy <= 100 + 1e-9 ? 'jump-apex' : 'jump-fall';
  return `idle-${Math.floor(f.age / 15) % 2}`;
}
