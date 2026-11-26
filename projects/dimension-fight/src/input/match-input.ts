import { CombatInputBuffer } from './combat-input.ts';

export type MatchShortcut = 'Enter' | 'Escape' | 'KeyR';
const SHORTCUTS = new Set<string>(['Enter', 'Escape', 'KeyR']);

/** Transitions clear combat pulses, but held shortcuts still require a key release. */
export class MatchInputBuffer {
  private combat = new CombatInputBuffer();
  private held = new Set<string>();
  keyDown(code: string, repeat: boolean, focused: boolean, playing: boolean): MatchShortcut | null {
    if (SHORTCUTS.has(code)) {
      const wasHeld = this.held.has(code);
      this.held.add(code);
      return focused && !repeat && !wasHeld ? code as MatchShortcut : null;
    }
    this.combat.keyDown(code, repeat, focused && playing);
    return null;
  }
  keyUp(code: string) { this.held.delete(code); this.combat.keyUp(code); }
  reset() { this.combat.reset(); }
  sample() { return this.combat.sample(); }
}
