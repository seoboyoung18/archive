import type { MovementRules } from './movement.ts';

export type Posture = 'stand' | 'crouch';
export type AttackSlot = 'lp' | 'hp' | 'lk' | 'hk';
export type AttackKey = `${Posture}-${AttackSlot}`;
export type AttackHeight = 'normal' | 'overhead' | 'low';
export interface Rect { left: number; right: number; top: number; bottom: number }
export interface AttackDefinition {
  startup: number; active: number; recovery: number;
  damage: number; hitstun: number; blockstun: number;
  push: number; blockPush: number; height: AttackHeight; box: Rect;
}
export interface CharacterDefinition {
  id: string; maxHp: number; movement: MovementRules;
  hurt: Record<Posture, Rect>;
  attacks: Record<AttackKey, AttackDefinition>;
}
export const ATTACK_SLOTS: readonly AttackSlot[] = ['lp', 'hp', 'lk', 'hk'];
export const ATTACK_PRIORITY: readonly AttackSlot[] = ['hk', 'hp', 'lk', 'lp'];

export function validateCharacter(def: CharacterDefinition): void {
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  const rect = (r: Rect) => r && Object.values(r).every(Number.isFinite)
    && r.left < r.right && r.top < r.bottom;
  if (!def.id || !positive(def.maxHp) || !positive(def.movement.speed)
    || !positive(def.movement.gravity) || !Number.isFinite(def.movement.jumpSpeed)
    || def.movement.jumpSpeed >= 0) throw new Error('Invalid character movement or health');
  for (const posture of ['stand', 'crouch'] as const) {
    if (!rect(def.hurt[posture])) throw new Error(`Invalid hurtbox: ${posture}`);
    for (const slot of ATTACK_SLOTS) {
      const key: AttackKey = `${posture}-${slot}`, a = def.attacks[key];
      if (!a || ![a.startup, a.active, a.recovery, a.hitstun, a.blockstun].every(n => Number.isInteger(n) && n > 0)
        || !positive(a.damage) || ![a.push, a.blockPush].every(n => Number.isFinite(n) && n >= 0)
        || !['normal', 'overhead', 'low'].includes(a.height) || !rect(a.box)) {
        throw new Error(`Invalid attack: ${key}`);
      }
    }
  }
}
