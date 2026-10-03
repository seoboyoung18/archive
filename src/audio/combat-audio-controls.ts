import type { CombatState } from '../combat/combat.ts';
import { CombatAudio } from './combat-audio.ts';
import { CombatSoundCursor } from './combat-sound-cues.ts';
import { H1_SOUND_ASSETS } from './h1-sound-assets.ts';

/** Both game pages use the same audio controls and independently loaded optional sounds. */
export function createCombatAudioControls(pauseGame: () => void, signal: AbortSignal) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const enabled = get<HTMLInputElement>('sound-enabled'), volume = get<HTMLInputElement>('sound-volume');
  const value = get<HTMLOutputElement>('sound-volume-value'), status = get<HTMLOutputElement>('sound-status');
  const telemetry = get<HTMLParagraphElement>('sound-telemetry');
  const cursor = new CombatSoundCursor();
  let disposed = false;
  const labels = new Map(H1_SOUND_ASSETS.map(asset => [asset.id, asset.label]));
  const audio = new CombatAudio(undefined, state => {
    if (enabled.checked !== state.enabled) enabled.checked = state.enabled;
    const percent = String(Math.round(state.volume * 100));
    if (volume.value !== percent) volume.value = percent;
    if (value.value !== `${percent}%`) value.value = `${percent}%`;
    const message = !state.enabled ? '효과음 꺼짐'
      : state.volume === 0 ? '음량 0% · 무음'
      : state.contextState === 'unavailable' ? '소리를 활성화하지 못했습니다. 무음으로 진행할 수 있습니다.'
      : state.failedIds.length ? '일부 소리를 준비하지 못했습니다. 준비된 효과음으로 진행합니다.'
      : state.paused ? state.unlocked ? '소리 준비됨 · 게임 정지 중' : '게임 정지 중 · 계속하기로 소리를 활성화합니다.'
      : state.unlocked ? state.readyCount === H1_SOUND_ASSETS.length ? '효과음 켜짐' : '효과음 준비 중'
      : state.contextState === 'uninitialized' ? '시작하면 소리를 활성화합니다.' : state.message;
    if (status.value !== message) status.value = message;
    const detail = `소리 세션 ${cursor.session} · 오디오 ${state.contextState} · 준비 ${state.readyCount}/9 · 재생 ${state.played} · 폐기 ${state.dropped} · 실행 ${state.active} · 최근 ${state.lastSound ? labels.get(state.lastSound) ?? state.lastSound : '없음'} · 소비 기록 ${cursor.retainedCount}`
      + (state.failedIds.length ? ` · 준비 실패 ${state.failedIds.map(id => labels.get(id) ?? id).join(', ')}` : '');
    if (telemetry.textContent !== detail) telemetry.textContent = detail;
  });
  const pause = () => audio.setPaused(true);
  const activate = () => { void audio.activate(); };
  enabled.addEventListener('change', () => {
    const selected = enabled.checked;
    pauseGame(); pause(); audio.setEnabled(selected);
    if (selected) activate();
  }, { signal });
  volume.addEventListener('input', () => {
    const selected = Number(volume.value) / 100;
    pauseGame(); pause(); audio.setVolume(selected);
    if (selected > 0 && audio.state.enabled) activate();
  }, { signal });
  window.addEventListener('pagehide', pause, { signal });

  // Fetch/decode failures never enter Phaser's mandatory image load/error path.
  for (const asset of H1_SOUND_ASSETS) void (async () => {
    try {
      if (!asset.url) throw new Error('missing sound');
      const response = await fetch(asset.url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      if (!disposed) audio.load(asset.id, data);
    } catch { if (!disposed && !signal.aborted) audio.fail(asset.id); }
  })();

  return {
    pause,
    resume() { audio.setPaused(false); activate(); },
    beginSession() { cursor.beginSession(); audio.beginSession(); },
    consume(state: CombatState) { audio.consume(cursor.consume(state)); },
    dispose() { disposed = true; audio.dispose(); },
  };
}
