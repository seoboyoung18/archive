import { attackPhase, type CombatFighter } from '../combat/combat.ts';
import type { CharacterDefinition } from '../combat/definition.ts';
import { movementPose } from '../combat/movement.ts';

/** Paths are relative to assets/characters/h1/derived. Every state has an explicit asset. */
export const H1_POSES: Record<string, string> = {
  'idle-0': 'v2/idle.png', 'idle-1': 'movement-v1/idle-1.png', crouch: 'v2/crouch.png',
  'stand-lp-startup': 'v2/startup.png', 'stand-lp-active': 'v2/active.png', 'stand-lp-recovery': 'v2/recovery.png',
  'crouch-lk-startup': 'v2/crouch-startup.png', 'crouch-lk-active': 'v2/crouch-active.png', 'crouch-lk-recovery': 'v2/crouch-recovery.png',
};
for (const name of ['jump-rise','jump-apex','jump-fall']) H1_POSES[name] = `movement-v1/${name}.png`;
for (const attack of ['stand-hp','stand-lk','stand-hk','crouch-lp','crouch-hp','crouch-hk']) {
  for (const phase of ['startup','active','recovery']) H1_POSES[`${attack}-${phase}`] = `combat-v1/${attack}-${phase}.png`;
}
for (const name of ['stand-guard','crouch-guard','stand-hit','crouch-hit','ko-0','ko-1','ko-2']) H1_POSES[name] = `combat-v1/${name}.png`;
for (const name of ['lp-extend','lp-retract','lp-settle']) H1_POSES[name] = `motion-v1/${name}.png`;
for (let i = 0; i < 12; i++) {
  const name = `walk-${String(i).padStart(2, '0')}`;
  H1_POSES[name] = `walk-v2/${name}.png`;
}

/** Artwork subdivisions inside the approved combat phases; never adds active ticks. */
export const H1_ATTACK_FRAMES: Record<string, Record<'startup' | 'active' | 'recovery', string[]>> = {
  'stand-lp': {
    startup: ['stand-lp-startup', 'lp-extend'], active: ['stand-lp-active'],
    recovery: ['lp-retract', 'stand-lp-recovery', 'lp-settle'],
  },
};
for (const attack of ['stand-hp','stand-lk','stand-hk','crouch-lp','crouch-hp','crouch-lk','crouch-hk']) {
  const additions = attack === 'stand-hk' ? ['lift','apex','descend','retract','settle'] : ['extend','retract','settle'];
  for (const pose of additions) H1_POSES[`${attack}-${pose}`] = `attack-motion-v1/${attack}-${pose}.png`;
  H1_ATTACK_FRAMES[attack] = {
    startup: [ `${attack}-startup`, ...additions.slice(0, -2).map(p => `${attack}-${p}`) ],
    active: [`${attack}-active`],
    recovery: attack === 'crouch-lk' || attack === 'crouch-hk'
      ? [`${attack}-retract`, `${attack}-settle`, `${attack}-recovery`]
      : [`${attack}-retract`, `${attack}-recovery`, `${attack}-settle`],
  };
}

for (const pose of ['stand-lk-startup','stand-lk-recovery','stand-hk-recovery']) H1_POSES[pose] = `attack-motion-v1/${pose}.png`;

export function combatPose(f: CombatFighter, definition: CharacterDefinition, koFrame = 0): string {
  if (f.action === 'ko') return `ko-${Math.min(2, Math.floor(Math.max(0, koFrame) / 6))}`;
  if (f.action === 'attack' && f.attack) {
    const phase = attackPhase(f, definition);
    if (!phase) throw new Error('Attack pose requested outside its lifetime');
    const attack = definition.attacks[f.attack.key]!;
    const frames = H1_ATTACK_FRAMES[f.attack.key]?.[phase];
    if (!frames?.length) throw new Error(`Missing H1 attack artwork: ${f.attack.key}`);
    const phaseAge = f.attack.age - (phase === 'startup' ? 0 : phase === 'active' ? attack.startup : attack.startup + attack.active);
    return frames[Math.floor(phaseAge * frames.length / attack[phase])]!;
  }
  if (f.action === 'hit' || f.action === 'guard') return `${f.posture}-${f.action}`;
  if (f.state === 'walk') {
    const segment = Math.floor(f.age / 4) % 12;
    const index = f.walkDirection === f.facing ? segment : (12 - segment) % 12;
    return `walk-${String(index).padStart(2, '0')}`;
  }
  return movementPose(f);
}
