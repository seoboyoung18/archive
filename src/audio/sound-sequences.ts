import { createCombat, stepCombat, COMBAT_NEUTRAL } from '../combat/combat.ts';
import { H1 } from '../characters/h1.ts';

export interface SoundCue { id: string; at: number }
export interface SoundSequence { id: string; label: string; description: string; cues: SoundCue[] }

/** A listening fixture, derived from ordinary public inputs; never controls either game page. */
export function comboSoundCues(): SoundCue[] {
  let combat = createCombat();
  combat.fighters[0].x = 500; combat.fighters[1].x = 600;
  const hits: { id: string; frame: number }[] = [];
  for (let frame = 0; frame < 60; frame++) {
    const attacks = frame === 0 ? ['lp'] as const : frame === 3 ? ['hp'] as const
      : frame === 14 ? ['lk'] as const : [];
    combat = stepCombat(combat, [{ ...COMBAT_NEUTRAL, attacks }, COMBAT_NEUTRAL]);
    for (const event of combat.events) if (!event.blocked) {
      hits.push({ id: `hit-${event.key.split('-')[1]}`, frame });
    }
  }
  return hits.map(hit => ({ id: hit.id, at: (hit.frame - hits[0]!.frame) / 60 }));
}

export const SOUND_SEQUENCES: SoundSequence[] = [
  { id: 'combo', label: 'U → I → J 콤보', description: '약손 → 강손 → 약발 · 첫 타격부터 0 / 217 / 400ms', cues: comboSoundCues() },
  { id: 'simultaneous', label: '동시 타격', description: '같은 강손 2개가 동시에 겹치는 소리', cues: [{ id: 'hit-hp', at: 0 }, { id: 'hit-hp', at: 0 }] },
  { id: 'throw', label: '붙잡음 → 메치기', description: '붙잡은 뒤 0.6초에 바닥 충돌', cues: [{ id: 'grab-hold', at: 0 }, { id: 'grab-impact', at: H1.grab!.impact / 60 }] },
  { id: 'escape', label: '붙잡음 → 풀기', description: '풀기 마지막 허용 시점 · 0.2초 뒤 분리', cues: [{ id: 'grab-hold', at: 0 }, { id: 'grab-escape', at: H1.grab!.techWindow / 60 }] },
  { id: 'instant-escape', label: '잡히는 순간 풀기', description: '붙잡음·충격 없이 풀기 소리만', cues: [{ id: 'grab-escape', at: 0 }] },
];

export function allSoundCues(sounds: readonly { id: string; durationMs: number }[]): SoundCue[] {
  let at = 0;
  return sounds.map(sound => { const cue = { id: sound.id, at }; at += sound.durationMs / 1000 + 0.35; return cue; });
}
