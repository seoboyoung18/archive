import type { MoveInput } from '../combat/movement.ts';

const KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
export class MovementInput {
  private held = new Set<string>();
  private blocked = new Set<string>();
  private jumpPressed = false;

  keyDown(code: string, repeat = false, active = true) {
    if (!KEYS.has(code)) return;
    if (!active) { this.blocked.add(code); return; }
    if (repeat || this.blocked.has(code) || this.held.has(code)) return;
    this.held.add(code);
    if (code === 'KeyW') this.jumpPressed = true;
  }
  keyUp(code: string) { this.held.delete(code); this.blocked.delete(code); }
  reset() {
    for (const code of this.held) this.blocked.add(code);
    this.held.clear(); this.jumpPressed = false;
  }
  sample(): MoveInput {
    const up = this.held.has('KeyW'), down = this.held.has('KeyS');
    const axis = Number(this.held.has('KeyD')) - Number(this.held.has('KeyA')) as -1 | 0 | 1;
    const result = { axis, crouch: down && !up, jump: this.jumpPressed && !down };
    this.jumpPressed = false;
    return result;
  }
}
