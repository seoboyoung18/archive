import { attackPhase, grabPoseState, type CombatFighter } from '../combat/combat.ts';
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

// The first full extension hits; the old asset named "active" depicts the lowered leg.
H1_ATTACK_FRAMES['stand-hk'] = {
  startup: ['stand-hk-startup', 'stand-hk-lift'],
  active: ['stand-hk-apex'],
  recovery: ['stand-hk-descend', 'stand-hk-active', 'stand-hk-retract', 'stand-hk-recovery', 'stand-hk-settle'],
};

for (const pose of ['stand-lk-startup','stand-lk-recovery','stand-hk-recovery']) H1_POSES[pose] = `attack-motion-v1/${pose}.png`;

/** Grab artwork is separate from normal attacks and from KO artwork. */
export const H1_GRAB_POSES = ["grab-ready","grab-reach","grab-retract","grab-settle","grab-stand-hold","grab-stand-brace","grab-stand-push","grab-crouch-hold","grab-crouch-brace","grab-crouch-push","grabbed-stand-hold","grabbed-stand-impact","grabbed-stand-recover","grabbed-crouch-hold","grabbed-crouch-impact","grabbed-crouch-recover","grab-release","grabbed-stand-escape","grabbed-crouch-escape"] as const;
for (const pose of H1_GRAB_POSES) H1_POSES[pose] = `grab-v1/${pose}.png`;

export const H1_THROW_POSES = ['throw-turn', 'throw-lift', 'throw-slam', 'thrown-air', 'thrown-down', 'thrown-rise'] as const;
for (const pose of H1_THROW_POSES) H1_POSES[pose] = `throw-v1/${pose}.png`;

/** Retained only for the visual before/after review; combat always uses H1_POSES. */
export const H1_PREVIOUS_HEAVY_POSES: Record<string, string> = {};
for (const attack of ['stand-hp','stand-hk','crouch-hp','crouch-hk']) {
  for (const pose of Object.values(H1_ATTACK_FRAMES[attack]!).flat()) {
    H1_PREVIOUS_HEAVY_POSES[pose] = H1_POSES[pose]!;
    H1_POSES[pose] = `opposite-limbs-v1/${pose}.png`;
  }
}

export function combatPose(f: CombatFighter, definition: CharacterDefinition, koFrame = 0): string {
  const grab = grabPoseState(f);
  if (f.action === 'ko') {
    if (grab?.kind === 'success' && grab.role === 'target') return 'thrown-down';
    return `ko-${Math.min(2, Math.floor(Math.max(0, koFrame) / 6))}`;
  }
  if (grab) {
    const { kind, role, age, targetPosture } = grab;
    if (kind === 'attempt') return age < 3 ? 'grab-ready' : age < 8 ? 'grab-reach' : age < 20 ? 'grab-retract' : 'grab-settle';
    if (kind === 'escape') return role === 'target'
      ? `grabbed-${targetPosture}-${age < 4 ? 'escape' : 'recover'}`
      : age < 4 ? 'grab-release' : age < 8 ? 'grab-retract' : 'grab-settle';
    const impact = grab.impactAt ?? definition.grab!.impact, turn = (grab.techUntil ?? definition.grab!.techWindow) + 1;
    const lift = Math.min(impact, turn + Math.max(1, Math.floor((impact - turn) / 3)));
    if (role === 'target') {
      if (age < lift) return `grabbed-${targetPosture}-hold`;
      if (age < impact) return 'thrown-air';
      const recovery = Math.max(1, grab.releaseAt - impact);
      if (age < impact + recovery / 3) return 'thrown-down';
      if (age < impact + recovery * 2 / 3) return 'thrown-rise';
      return `grabbed-${targetPosture}-recover`;
    }
    if (age < turn) return `grab-${targetPosture}-hold`;
    if (age < lift) return 'throw-turn';
    if (age < impact) return age < lift + (impact - lift) / 2 ? 'throw-lift' : 'throw-slam';
    return age < impact + (grab.releaseAt - impact) / 2 ? 'throw-slam' : 'grab-settle';
  }
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
