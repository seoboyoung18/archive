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
export interface ComboLink {
  next: AttackKey;
  inputStart: number; inputEnd: number;
  cancelStart: number; cancelEnd: number;
}
export interface ComboDefinition { start: AttackKey; links: readonly ComboLink[] }
export interface GrabDefinition {
  inputWindow: number; startup: number; active: number; recovery: number;
  range: number; damage: number; push: number; techWindow: number; impact: number;
  targetRecovery: number; attackerRecovery: number; escapeRecovery: number; escapePush: number;
}
export interface CharacterDefinition {
  id: string; maxHp: number; movement: MovementRules;
  hurt: Record<Posture, Rect>;
  attacks: Record<AttackKey, AttackDefinition>;
  combo?: ComboDefinition;
  grab?: GrabDefinition;
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
  if (def.combo) {
    let key = def.combo.start;
    const used = new Set<AttackKey>([key]);
    if (!def.attacks[key] || !def.combo.links.length) throw new Error('Invalid combo start');
    for (const link of def.combo.links) {
      const attack = def.attacks[key];
      if (!def.attacks[link.next] || used.has(link.next)
        || ![link.inputStart, link.inputEnd, link.cancelStart, link.cancelEnd].every(n => Number.isInteger(n) && n >= 0)
        || link.inputStart > link.inputEnd || link.inputEnd > link.cancelEnd
        || link.cancelStart > link.cancelEnd || link.cancelStart < attack.startup + attack.active
        || link.cancelEnd >= attack.startup + attack.active + attack.recovery) throw new Error('Invalid combo link');
      used.add(link.next); key = link.next;
    }
  }
  if (def.grab) {
    const g = def.grab;
    if (![g.inputWindow, g.startup, g.active, g.recovery, g.techWindow, g.impact,
      g.targetRecovery, g.attackerRecovery, g.escapeRecovery].every(n => Number.isInteger(n) && n > 0)
      || ![g.range, g.damage].every(positive) || ![g.push, g.escapePush].every(n => Number.isFinite(n) && n >= 0)
      || g.impact <= g.techWindow || g.targetRecovery <= g.impact || g.attackerRecovery <= g.impact) {
      throw new Error('Invalid grab definition');
    }
  }
}
