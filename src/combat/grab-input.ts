import { ATTACK_PRIORITY, type AttackSlot } from './definition.ts';

export type HandSlot = 'lp' | 'hp';
export interface HandEvent { slot: HandSlot; down: boolean }
export interface HandState {
  held: Record<HandSlot, boolean>;
  downAt: Record<HandSlot, number | null>;
  pending: { slot: HandSlot; frame: number } | null;
}
export interface HandInput {
  attacks: readonly AttackSlot[]; handEvents?: readonly HandEvent[];
  crouch: boolean; jump: boolean;
}
export function createHandState(): HandState {
  return { held: { lp: false, hp: false }, downAt: { lp: null, hp: null }, pending: null };
}
/** Held keys remain held, but cannot become the first half of a future command. */
export function clearHandIntent(s: HandState): HandState {
  return { held: { ...s.held }, downAt: { lp: null, hp: null }, pending: null };
}
export function copyHands(s: HandState): HandState {
  return { held: { ...s.held }, downAt: { ...s.downAt }, pending: s.pending ? { ...s.pending } : null };
}

/** Pure ordered edge interpretation. Missing edges represent legacy/CPU short taps. */
export function readHands(previous: HandState, input: HandInput, frame: number, window: number,
  mode: 'free' | 'blocked' | 'tech'): {
    state: HandState; action: AttackSlot | 'grab' | null; consumeJump: boolean; tech: boolean;
  } {
  let state = copyHands(previous);
  const events = input.handEvents ?? input.attacks.flatMap(slot => slot === 'lp' || slot === 'hp'
    ? [{ slot, down: true }, { slot, down: false }] : []);
  const pressed = new Set<HandSlot>();
  let chord = false, releasedPending = false;
  for (const event of events) {
    const slot = event.slot, other: HandSlot = slot === 'lp' ? 'hp' : 'lp';
    if (event.down) {
      if (state.held[slot]) continue;
      state.held[slot] = true; state.downAt[slot] = frame; pressed.add(slot);
      const otherFrame = state.downAt[other];
      if (state.held[other] && otherFrame !== null && frame - otherFrame <= window) chord = true;
    } else {
      if (state.held[slot] && previous.pending?.slot === slot) releasedPending = true;
      state.held[slot] = false; state.downAt[slot] = null;
    }
  }
  const result = (action: AttackSlot | 'grab' | null, consumeJump = false, tech = false) =>
    ({ state, action, consumeJump, tech });
  const commit = (action: AttackSlot | 'grab') => {
    state = clearHandIntent(state); return result(action, true);
  };
  if (mode === 'blocked') { state = clearHandIntent(state); return result(null); }
  if (mode === 'tech') {
    state.pending = null;
    if (chord) state = clearHandIntent(state);
    return result(null, false, chord);
  }
  // A new direction action interrupts a wait that was already in progress.
  if (previous.pending && (input.jump || input.crouch)) {
    state = clearHandIntent(state); return result(null);
  }
  const feet = input.attacks.filter(slot => slot === 'lk' || slot === 'hk');
  if (input.crouch) {
    // Two fresh hands while crouching are consumed, leaving any foot command.
    const candidates = pressed.size === 2 ? feet : [...feet, ...pressed];
    const action = ATTACK_PRIORITY.find(slot => candidates.includes(slot)) ?? null;
    state = clearHandIntent(state);
    return result(action, action !== null);
  }
  if (chord) return commit('grab');
  if (feet.length) {
    // A failed opposite hand is consumed; only the existing wait competes with new feet.
    const candidates: AttackSlot[] = previous.pending ? [...feet, previous.pending.slot] : [...feet, ...pressed];
    return commit(ATTACK_PRIORITY.find(slot => candidates.includes(slot))!);
  }
  if (previous.pending) {
    if (releasedPending || frame - previous.pending.frame >= window) return commit(previous.pending.slot);
    return result(null, true);
  }
  if (pressed.size === 2) return commit('hp');
  const slot = [...pressed][0];
  if (slot) {
    if (!state.held[slot]) return commit(slot);
    state.pending = { slot, frame }; return result(null, true);
  }
  return result(null);
}
