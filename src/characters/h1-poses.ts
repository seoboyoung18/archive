import { attackPhase, type CombatFighter } from '../combat/combat.ts';
import type { CharacterDefinition } from '../combat/definition.ts';
import { movementPose } from '../combat/movement.ts';

/** Paths are relative to assets/characters/h1/derived. Every state has an explicit asset. */
export const H1_POSES: Record<string, string> = {
  'idle-0': 'v2/idle.png', 'idle-1': 'movement-v1/idle-1.png', crouch: 'v2/crouch.png',
  'stand-lp-startup': 'v2/startup.png', 'stand-lp-active': 'v2/active.png', 'stand-lp-recovery': 'v2/recovery.png',
  'crouch-lk-startup': 'v2/crouch-startup.png', 'crouch-lk-active': 'v2/crouch-active.png', 'crouch-lk-recovery': 'v2/crouch-recovery.png',
};
for (const name of ['walk-0','walk-1','walk-2','walk-3','jump-rise','jump-apex','jump-fall']) H1_POSES[name] = `movement-v1/${name}.png`;
for (const attack of ['stand-hp','stand-lk','stand-hk','crouch-lp','crouch-hp','crouch-hk']) {
  for (const phase of ['startup','active','recovery']) H1_POSES[`${attack}-${phase}`] = `combat-v1/${attack}-${phase}.png`;
}
for (const name of ['stand-guard','crouch-guard','stand-hit','crouch-hit','ko-0','ko-1','ko-2']) H1_POSES[name] = `combat-v1/${name}.png`;

export function combatPose(f: CombatFighter, definition: CharacterDefinition, koFrame = 0): string {
  if (f.action === 'ko') return `ko-${Math.min(2, Math.floor(Math.max(0, koFrame) / 6))}`;
  if (f.action === 'attack' && f.attack) {
    const phase = attackPhase(f, definition);
    if (!phase) throw new Error('Attack pose requested outside its lifetime');
    return `${f.attack.key}-${phase}`;
  }
  if (f.action === 'hit' || f.action === 'guard') return `${f.posture}-${f.action}`;
  return movementPose(f);
}
