import { MovementInput } from './movement-input.ts';
import { ATTACK_PRIORITY, type AttackSlot } from '../combat/definition.ts';
import type { CombatInput } from '../combat/combat.ts';

const ATTACK_KEYS: Readonly<Record<string, AttackSlot>> = { KeyU: 'lp', KeyI: 'hp', KeyJ: 'lk', KeyK: 'hk' };
export class CombatInputBuffer {
  private movement = new MovementInput();
  private held = new Set<string>();
  private blocked = new Set<string>();
  private pressed = new Set<AttackSlot>();
  keyDown(code: string, repeat = false, active = true) {
    this.movement.keyDown(code, repeat, active);
    const slot = ATTACK_KEYS[code];
    if (!slot) return;
    if (!active) { this.blocked.add(code); return; }
    if (repeat || this.held.has(code) || this.blocked.has(code)) return;
    this.held.add(code); this.pressed.add(slot);
  }
  keyUp(code: string) { this.movement.keyUp(code); this.held.delete(code); this.blocked.delete(code); }
  reset() {
    this.movement.reset();
    for (const code of this.held) this.blocked.add(code);
    this.held.clear(); this.pressed.clear();
  }
  sample(): CombatInput {
    const input = { ...this.movement.sample(), attacks: ATTACK_PRIORITY.filter(slot => this.pressed.has(slot)) };
    this.pressed.clear();
    return input;
  }
}
