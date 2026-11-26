import { overlaps, worldRect, type CombatInput, type CombatFighter } from './combat.ts';
import type { AttackKey, AttackSlot, CharacterDefinition, Posture } from './definition.ts';
import type { Direction } from './movement.ts';

export const H1_AI_ORDER: readonly AttackKey[] = [
  'stand-lp', 'stand-hp', 'stand-lk', 'stand-hk',
  'crouch-lp', 'crouch-hp', 'crouch-lk', 'crouch-hk',
];
export const H1_AI_GRAB_COOLDOWN = 120;
export interface H1AiGrab {
  kind: 'attempt' | 'success' | 'escape'; role: 'attacker' | 'target';
  phase: 'attempt' | 'hold' | 'throw' | 'down' | 'escape'; owner: 0 | 1; serial: number;
}
export interface H1AiFighter extends Pick<CombatFighter,
  'x' | 'y' | 'facing' | 'grounded' | 'posture' | 'action' | 'state' | 'walkDirection'> {
  attack: { key: AttackKey; phase: 'startup' | 'active' | 'recovery' | null } | null;
  grab: H1AiGrab | null;
}
export interface H1AiObservation {
  self: H1AiFighter; opponent: H1AiFighter;
  selfDefinition: CharacterDefinition; opponentDefinition: CharacterDefinition;
}
export interface H1AiState {
  cursor: number; // Zero-based index into H1_AI_ORDER; the spec numbers candidates from 1.
  untilDecision: number;
  axis: -1 | 0 | 1;
  crouch: boolean;
  grabCooldown: number;
  captureCount: number;
  lastCapture: { owner: 0 | 1; serial: number } | null;
}
export function createH1Ai(): H1AiState {
  return { cursor: 0, untilDecision: 0, axis: 0, crouch: false, grabCooldown: 0, captureCount: 0, lastCapture: null };
}
export function clearH1AiInput(s: H1AiState): H1AiState { return { ...s, axis: 0, crouch: false }; }
const command = (axis: -1 | 0 | 1, crouch = false, attacks: readonly AttackSlot[] = []): CombatInput =>
  ({ axis, crouch, attacks, jump: false });
const grabCommand = (): CombatInput => ({ ...command(0, false, ['lp', 'hp']), handEvents: [
  { slot: 'lp', down: true }, { slot: 'hp', down: true },
  { slot: 'hp', down: false }, { slot: 'lp', down: false },
] });

function decide(s: H1AiState, view: H1AiObservation): { ai: H1AiState; input: CombatInput } {
  const { self, opponent: other, selfDefinition: def, opponentDefinition: otherDef } = view;
  const toward: Direction = other.x > self.x ? 1 : -1, away: Direction = toward === 1 ? -1 : 1;
  const d = Math.abs(other.x - self.x), crouch = self.grounded && self.posture === 'crouch';
  const keep = (input: CombatInput) => ({ ai: s, input });
  const g = self.grab;
  if (self.action === 'grab' && g?.kind === 'success' && g.role === 'target' && g.phase === 'hold') {
    if (s.lastCapture?.owner === g.owner && s.lastCapture.serial === g.serial) return keep(command(0));
    const captureCount = s.captureCount + 1;
    return { ai: { ...s, captureCount, lastCapture: { owner: g.owner, serial: g.serial } },
      input: captureCount % 2 === 0 ? grabCommand() : command(0) };
  }
  if (self.action === 'grab') return keep(command(0));
  if (!self.grounded || ['ko', 'attack', 'hit'].includes(self.action)) return keep(command(0, crouch));
  if (other.attack && (other.attack.phase === 'startup' || other.attack.phase === 'active')) {
    const attack = otherDef.attacks[other.attack.key];
    if (overlaps(worldRect(attack.box, other), worldRect(def.hurt[self.posture], self))) {
      return keep(command(away, attack.height === 'normal' ? crouch : attack.height === 'low'));
    }
  }
  if (self.action === 'guard') return keep(command(away, crouch));
  if (other.action === 'grab' && other.grab?.kind === 'success' && other.grab.role === 'target') return keep(command(0));
  if (!other.grounded) return keep(command(d > 160 ? toward : 0));

  const standGuard = other.posture === 'stand' && (other.action === 'guard'
    || (other.action === 'free' && other.state === 'walk' && other.walkDirection === toward));
  if (self.action === 'free' && def.grab && s.grabCooldown === 0
    && (other.action === 'free' || other.action === 'guard') && (other.posture === 'crouch' || standGuard)) {
    if (d > def.grab.range) return keep(command(toward));
    if (other.action === 'guard') return keep(command(0));
    return { ai: { ...s, grabCooldown: H1_AI_GRAB_COOLDOWN }, input: grabCommand() };
  }

  const hurt = otherDef.hurt[other.posture];
  const fits = (key: AttackKey) => {
    const a = def.attacks[key];
    if (key === 'stand-hk' && other.posture === 'crouch') return false;
    return d <= a.box.right - hurt.left - 8
      && overlaps(worldRect(a.box, { ...self, facing: toward }), worldRect(hurt, other));
  };
  const select = (index: number) => {
    const [posture, slot] = H1_AI_ORDER[index]!.split('-') as [Posture, AttackSlot];
    return { ai: { ...s, cursor: (index + 1) % H1_AI_ORDER.length }, input: command(0, posture === 'crouch', [slot]) };
  };
  if (standGuard) {
    for (const index of [6, 7]) if (fits(H1_AI_ORDER[index]!)) return select(index);
  } else {
    for (let offset = 0; offset < H1_AI_ORDER.length; offset++) {
      const index = (s.cursor + offset) % H1_AI_ORDER.length;
      if (fits(H1_AI_ORDER[index]!)) return select(index);
    }
  }
  return keep(command(toward));
}

/** Observation is lazy: only decision ticks can read the visible combat snapshot. */
export function stepH1Ai(s: H1AiState, observe: () => H1AiObservation, locked = false): { ai: H1AiState; input: CombatInput } {
  const next = { ...s, grabCooldown: Math.max(0, s.grabCooldown - 1) };
  // Grab locks silence even previously held movement; the existing decision clock keeps running.
  if (locked) return { ai: { ...next, axis: 0, crouch: false, untilDecision: s.untilDecision > 0 ? s.untilDecision - 1 : 11 }, input: command(0) };
  if (s.untilDecision > 0) return { ai: { ...next, untilDecision: s.untilDecision - 1 }, input: command(s.axis, s.crouch) };
  const { ai, input } = decide(next, observe());
  return { ai: { ...ai, untilDecision: 11, axis: input.axis, crouch: input.crouch }, input };
}
