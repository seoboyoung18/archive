import type { CombatState } from '../combat/combat.ts';

export type CombatSoundCue = { key: string; id: string };
type Consumed = { owner: string; frame: number };

/** Read each completed combat tick once, even while audio itself is unavailable. */
export class CombatSoundCursor {
  private sessionId = 0;
  private lastFrame = 0;
  private consumed = new Map<string, Consumed>();

  get session(): number { return this.sessionId; }
  get retainedCount(): number { return this.consumed.size; }

  beginSession(): void {
    this.sessionId++;
    this.lastFrame = 0;
    this.consumed.clear();
  }

  consume(state: CombatState): CombatSoundCue[] {
    if (state.frame <= this.lastFrame) return [];
    this.lastFrame = state.frame;

    const active = new Set<string>();
    for (const fighter of state.fighters) {
      if (fighter.attack) active.add(`attack:${fighter.id}:${fighter.attack.serial}`);
      if (fighter.grab?.role === 'attacker') active.add(`grab:${fighter.id}:${fighter.grab.serial}`);
    }
    if (state.grabPair) active.add(`grab:${state.grabPair.attacker}:${state.grabPair.serial}`);
    // The previous tick covers contacts whose action was cancelled or ended in that tick.
    for (const [key, entry] of this.consumed) {
      if (entry.frame < state.frame - 1 && !active.has(entry.owner)) this.consumed.delete(key);
    }

    const cues: CombatSoundCue[] = [];
    const add = (event: string, owner: string, id: string) => {
      const key = `${this.sessionId}:${event}`;
      if (this.consumed.has(key)) return;
      this.consumed.set(key, { owner, frame: state.frame });
      cues.push({ key, id });
    };
    for (const event of state.events) {
      const kind = event.blocked ? 'guard' : 'hit';
      add(`${kind}:${event.attacker}:${event.attackId}:${event.target}`,
        `attack:${event.attacker}:${event.attackId}`, event.blocked ? 'guard' : `hit-${event.key.split('-')[1]}`);
    }
    for (const event of state.whiffEvents) {
      add(`whiff:${event.attacker}:${event.attackId}`, `attack:${event.attacker}:${event.attackId}`, 'whiff');
    }
    for (const event of state.grabEvents) {
      add(`grab-${event.kind}:${event.attacker}:${event.grabId}`, `grab:${event.attacker}:${event.grabId}`, `grab-${event.kind}`);
    }
    return cues;
  }
}
