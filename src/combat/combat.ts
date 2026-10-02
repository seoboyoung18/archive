import { H1 } from '../characters/h1.ts';
import { ATTACK_PRIORITY, validateCharacter, type AttackKey, type AttackSlot, type CharacterDefinition, type Posture, type Rect } from './definition.ts';
import { createFighters, stepMovement, STAGE, NEUTRAL, type Fighter, type MoveInput } from './movement.ts';

export interface CombatInput extends MoveInput { attacks: readonly AttackSlot[] }
export const COMBAT_NEUTRAL: CombatInput = { ...NEUTRAL, attacks: [] };
export interface AttackInstance { key: AttackKey; serial: number; age: number; hitTargets: number[] }
export interface ComboProgress { step: number; confirmed: boolean; queued: boolean }
export interface CombatFighter extends Fighter {
  id: 0 | 1; hp: number; posture: Posture;
  action: 'free' | 'attack' | 'hit' | 'guard' | 'ko';
  attack: AttackInstance | null; stun: number; nextAttackId: number;
  combo: ComboProgress | null;
}
export interface HitEvent { attacker: 0 | 1; target: 0 | 1; attackId: number; key: AttackKey; blocked: boolean; damage: number }
export interface CombatState {
  definitions: readonly [CharacterDefinition, CharacterDefinition];
  fighters: [CombatFighter, CombatFighter]; frame: number; ended: boolean; events: HitEvent[];
}
export function createCombat(definitions: readonly [CharacterDefinition, CharacterDefinition] = [H1, H1]): CombatState {
  definitions.forEach(validateCharacter);
  const base = createFighters();
  const fighter = (id: 0 | 1): CombatFighter => ({ ...base[id], id, hp: definitions[id].maxHp,
    posture: 'stand', action: 'free', attack: null, stun: 0, nextAttackId: 1, combo: null });
  return { definitions, fighters: [fighter(0), fighter(1)], frame: 0, ended: false, events: [] };
}
export function attackPhase(f: CombatFighter, def: CharacterDefinition): 'startup' | 'active' | 'recovery' | null {
  if (!f.attack) return null;
  const a = def.attacks[f.attack.key], age = f.attack.age;
  if (age < a.startup) return 'startup';
  if (age < a.startup + a.active) return 'active';
  return age < a.startup + a.active + a.recovery ? 'recovery' : null;
}
export function worldRect(box: Rect, f: Pick<Fighter, 'x' | 'y' | 'facing'>): Rect {
  return { left: f.x + (f.facing === 1 ? box.left : -box.right),
    right: f.x + (f.facing === 1 ? box.right : -box.left), top: f.y + box.top, bottom: f.y + box.bottom };
}
export function overlaps(a: Rect, b: Rect): boolean {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left)
    && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
}

/** Pause drops the requested next key, while preserving attack age and hit confirmation. */
export function clearComboInputs(s: CombatState): CombatState {
  if (!s.fighters.some(f => f.combo?.queued)) return s;
  const clear = (f: CombatFighter): CombatFighter => f.combo?.queued
    ? { ...f, combo: { ...f.combo, queued: false } } : f;
  return { ...s, fighters: [clear(s.fighters[0]), clear(s.fighters[1])] };
}

/** Round end also removes the chain's eligibility; it never changes the last hit or pose. */
export function clearCombos(s: CombatState): CombatState {
  if (!s.fighters.some(f => f.combo)) return s;
  const clear = (f: CombatFighter): CombatFighter => f.combo ? { ...f, combo: null } : f;
  return { ...s, fighters: [clear(s.fighters[0]), clear(s.fighters[1])] };
}

function advanceCombo(f: CombatFighter, input: CombatInput, def: CharacterDefinition): void {
  if (!f.attack || !f.combo) return;
  const link = def.combo?.links[f.combo.step];
  const age = f.attack.age, attack = def.attacks[f.attack.key];
  if ((link && age > link.cancelEnd) || (!f.combo.confirmed && age >= attack.startup + attack.active)) {
    f.combo = null; return;
  }
  if (!link) return; // The final attack completes its normal recovery.
  if (age >= link.inputStart && age <= link.inputEnd && input.attacks.length === 1
    && input.attacks[0] === link.next.split('-')[1]) f.combo.queued = true;
  if (f.combo.confirmed && f.combo.queued && age >= link.cancelStart) {
    f.attack = { key: link.next, serial: f.nextAttackId++, age: 0, hitTargets: [] };
    f.combo = { step: f.combo.step + 1, confirmed: false, queued: false };
  }
}

/** One approved 1/60s tick. Callers stop calling while paused; ended combat is immutable. */
export function stepCombat(previous: CombatState, inputs: readonly [CombatInput, CombatInput]): CombatState {
  if (previous.ended) return previous;
  const copy = (f: CombatFighter): CombatFighter => ({ ...f,
    attack: f.attack ? { ...f.attack, hitTargets: [...f.attack.hitTargets] } : null,
    combo: f.combo ? { ...f.combo } : null });
  const fighters: [CombatFighter, CombatFighter] = [copy(previous.fighters[0]), copy(previous.fighters[1])];
  const movement: [MoveInput, MoveInput] = [NEUTRAL, NEUTRAL];
  const lockedFacing: [boolean, boolean] = [false, false];
  for (const i of [0, 1] as const) {
    const f = fighters[i], input = inputs[i], def = previous.definitions[i];
    if (f.attack) {
      f.attack.age++;
      if (!attackPhase(f, def)) { f.attack = null; f.combo = null; f.action = 'free'; }
      else advanceCombo(f, input, def);
    }
    // A hit's following N ticks are blocked, including the tick that decrements to zero.
    if (f.action === 'hit' || f.action === 'guard') {
      if (f.stun === 0) f.action = 'free';
      else f.stun--;
    }
    if (f.action === 'free' || f.action === 'guard') {
      f.posture = f.grounded && input.crouch ? 'crouch' : 'stand';
      if (f.grounded) f.facing = fighters[1 - i]!.x > f.x ? 1 : -1;
    }
    if (f.action === 'free' && f.grounded) {
      const slot = ATTACK_PRIORITY.find(candidate => input.attacks.includes(candidate));
      if (slot) {
        f.attack = { key: `${f.posture}-${slot}`, serial: f.nextAttackId++, age: 0, hitTargets: [] };
        f.combo = def.combo?.start === f.attack.key ? { step: 0, confirmed: false, queued: false } : null;
        f.action = 'attack';
      }
    }
    lockedFacing[i] = f.action === 'attack' || f.action === 'hit' || !f.grounded;
    movement[i] = f.action === 'free' ? input : { axis: 0, jump: false, crouch: f.posture === 'crouch' };
  }
  const moved = stepMovement(fighters, movement, [previous.definitions[0].movement, previous.definitions[1].movement]);
  for (const i of [0, 1] as const) {
    const f = fighters[i], facing = f.facing;
    Object.assign(f, moved[i]);
    if (lockedFacing[i]) f.facing = facing;
    if (f.action === 'free') f.posture = f.grounded && inputs[i].crouch ? 'crouch' : 'stand';
  }

  // Collect both contacts before cancelling attacks or changing health/stun/positions.
  const events: HitEvent[] = [];
  for (const i of [0, 1] as const) {
    const f = fighters[i], j = i === 0 ? 1 : 0, target = fighters[j], a = f.attack;
    if (!a || attackPhase(f, previous.definitions[i]) !== 'active' || a.hitTargets.includes(target.id)) continue;
    const def = previous.definitions[i].attacks[a.key];
    const hurt = previous.definitions[j].hurt[target.grounded ? target.posture : 'stand'];
    if (!overlaps(worldRect(def.box, f), worldRect(hurt, target))) continue;
    const away = target.x > f.x ? 1 : -1;
    const canGuard = target.grounded && (target.action === 'free' || target.action === 'guard') && inputs[j].axis === away;
    const blocked = canGuard && (def.height === 'normal' || (def.height === 'overhead' ? target.posture === 'stand' : target.posture === 'crouch'));
    events.push({ attacker: i, target: j, attackId: a.serial, key: a.key, blocked, damage: blocked ? 0 : def.damage });
  }
  // Store contact history first; an attacker may also be hit in this same tick.
  for (const event of events) {
    const attacker = fighters[event.attacker];
    attacker.attack!.hitTargets.push(event.target);
    if (event.blocked) attacker.combo = null;
    else if (attacker.combo) attacker.combo.confirmed = true;
  }
  for (const event of events) {
    const target = fighters[event.target];
    const def = previous.definitions[event.attacker].attacks[event.key];
    target.hp = Math.max(0, target.hp - event.damage);
    target.action = event.blocked ? 'guard' : 'hit';
    target.attack = null;
    target.combo = null;
    target.stun = event.blocked ? def.blockstun : def.hitstun;
    const direction = previous.fighters[event.target].x > previous.fighters[event.attacker].x ? 1 : -1;
    target.x = Math.max(STAGE.minX, Math.min(STAGE.maxX, target.x + direction * (event.blocked ? def.blockPush : def.push)));
  }
  const ended = fighters.some(f => f.hp === 0);
  for (const f of fighters) if (f.hp === 0) { f.action = 'ko'; f.attack = null; f.stun = 0; }
  if (ended) for (const f of fighters) f.combo = null;
  return { ...previous, fighters, events, frame: previous.frame + 1, ended };
}
