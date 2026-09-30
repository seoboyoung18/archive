export type Phase = 'idle' | 'startup' | 'active' | 'recovery';

/** Inspector-only cycle, with a 30-tick pause in the base pose. */
export function phaseAtTick(tick: number, frames: readonly [number, number, number]): Phase {
  const [startup, active, recovery] = frames;
  const age = Math.floor(tick) % (startup + active + recovery + 30);
  if (age < startup) return 'startup';
  if (age < startup + active) return 'active';
  if (age < startup + active + recovery) return 'recovery';
  return 'idle';
}
