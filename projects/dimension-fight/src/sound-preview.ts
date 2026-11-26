import './style.css';
import './sound-preview.css';
import manifest from '../assets/audio/h1/s1-v1/manifest.json';
import { PreviewPlayer } from './audio/preview-player.ts';
import { SOUND_SEQUENCES, allSoundCues, type SoundCue } from './audio/sound-sequences.ts';

const get = <T extends Element>(id: string) => document.getElementById(id) as unknown as T;
const status = get<HTMLParagraphElement>('play-status'), metrics = get<HTMLParagraphElement>('playback-metrics');
const result = get<HTMLParagraphElement>('playback-result'), volume = get<HTMLInputElement>('volume');
const allButton = get<HTMLButtonElement>('play-all');
const bytes = new Map<string, ArrayBuffer>();
const urls = import.meta.glob('../assets/audio/h1/s1-v1/*.wav', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
let selected = '', previousStatus = 'idle';
const player = new PreviewPlayer(undefined, state => {
  status.textContent = `${selected ? `${selected} · ` : ''}${state.message}`;
  metrics.textContent = `오디오 ${state.contextState} · 재생·예약 ${state.active}개`;
  if (state.status === 'idle' && previousStatus === 'playing') result.textContent = `${selected} · 재생 완료, 남은 예약 0개`;
  else if (state.status === 'stopped' || state.status === 'error') result.textContent = state.message;
  previousStatus = state.status;
});

const descriptions: Record<string, string> = {
  'hit-lp': '짧고 가벼운 손 타격', 'hit-hp': '두껍고 낮은 손 타격',
  'hit-lk': '넓게 퍼지는 발 타격', 'hit-hk': '무게 있는 발 충격',
  guard: '짧고 단단한 막힘', whiff: '공기를 가르는 짧은 움직임',
  'grab-hold': '옷깃을 움켜쥐는 마찰', 'grab-impact': '몸이 바닥에 부딪히는 충격', 'grab-escape': '붙잡힌 손을 떼어내는 분리',
};
const sequenceButtons: { button: HTMLButtonElement; cues: SoundCue[] }[] = [];

function listen(label: string, cues: readonly SoundCue[]) {
  selected = label;
  result.textContent = `${label} · 재생 요청`;
  void player.play(cues, bytes);
}

function waveform(buffer: ArrayBuffer, svg: SVGSVGElement) {
  const view = new DataView(buffer), count = (buffer.byteLength - 44) / 2;
  const bins = 64, stride = Math.max(1, Math.floor(count / bins));
  let path = '';
  for (let bin = 0; bin < bins; bin++) {
    let peak = 0;
    for (let i = bin * stride; i < Math.min(count, (bin + 1) * stride); i++) peak = Math.max(peak, Math.abs(view.getInt16(44 + i * 2, true) / 32768));
    const h = Math.max(1, Math.min(15, peak * 32));
    path += `M${bin * 4 + 2},${17 - h}v${h * 2} `;
  }
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', path); line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '2'); svg.append(line);
}

const cards = manifest.sounds.map((sound, index) => {
  const card = document.createElement('article'); card.className = 'sound-card';
  const number = document.createElement('span'); number.className = 'sound-index'; number.textContent = `${String(index + 1).padStart(2, '0')} / H1`;
  const heading = document.createElement('h3'); heading.textContent = sound.label;
  const description = document.createElement('p'); description.textContent = descriptions[sound.id] ?? '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 256 34'); svg.setAttribute('aria-hidden', 'true');
  const bottom = document.createElement('div'); bottom.className = 'card-bottom';
  const duration = document.createElement('span'); duration.textContent = `${sound.durationMs}ms · 준비 중`;
  const button = document.createElement('button'); button.textContent = '▶ 듣기'; button.disabled = true; button.setAttribute('aria-label', `${sound.label} 듣기`);
  button.addEventListener('click', () => listen(sound.label, [{ id: sound.id, at: 0 }]));
  bottom.append(duration, button); card.append(number, heading, description, svg, bottom); get('sound-grid').append(card);
  const detail = document.createElement('li'); detail.textContent = `${sound.label} · ${sound.durationMs}ms`;
  const link = document.createElement('a'); link.href = urls[`../assets/audio/h1/s1-v1/${sound.file}`]!; link.textContent = ' WAV'; link.download = sound.file; detail.append(link); get('asset-details').append(detail);
  return { sound, card, svg, duration, button };
});

for (const sequence of SOUND_SEQUENCES) {
  const button = document.createElement('button'); button.disabled = true;
  button.setAttribute('aria-label', `${sequence.label} 듣기`);
  const title = document.createElement('strong'); title.textContent = `▶ ${sequence.label}`;
  const description = document.createElement('small'); description.textContent = sequence.description;
  button.append(title, description); button.addEventListener('click', () => listen(sequence.label, sequence.cues));
  get('sequence-grid').append(button); sequenceButtons.push({ button, cues: sequence.cues });
}

function updateReady() {
  get('load-status').textContent = `${bytes.size} / ${cards.length}종 준비`;
  allButton.disabled = bytes.size !== cards.length;
  for (const { button, cues } of sequenceButtons) button.disabled = !cues.every(cue => bytes.has(cue.id));
}

void Promise.allSettled(cards.map(async ({ sound, card, svg, duration, button }) => {
  try {
    const url = urls[`../assets/audio/h1/s1-v1/${sound.file}`];
    if (!url) throw new Error('missing asset');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.arrayBuffer();
    waveform(data, svg); bytes.set(sound.id, data); button.disabled = false;
    duration.textContent = `${sound.durationMs}ms`; updateReady();
  } catch {
    card.classList.add('unavailable'); duration.textContent = '불러오기 실패';
    updateReady();
  }
})).then(() => {
  if (bytes.size < cards.length) get('load-status').textContent = `${bytes.size} / ${cards.length}종 준비 · 실패한 음원은 새로고침 후 다시 확인하세요`;
});

allButton.addEventListener('click', () => listen('전체 9종', allSoundCues(manifest.sounds)));
get('stop').addEventListener('click', () => player.stop('정지했습니다. 재생 버튼으로 다시 들을 수 있습니다.'));
window.addEventListener('keydown', event => { if (event.code === 'Escape') player.stop('정지했습니다. 재생 버튼으로 다시 들을 수 있습니다.'); });
volume.addEventListener('input', () => {
  get<HTMLOutputElement>('volume-value').value = `${volume.value}%`;
  player.setVolume(Number(volume.value) / 100);
});
window.addEventListener('blur', () => player.stop('창을 벗어나 정지했습니다. 버튼을 눌러 다시 들어주세요.'));
document.addEventListener('visibilitychange', () => { if (document.hidden) player.stop('탭을 벗어나 정지했습니다. 버튼을 눌러 다시 들어주세요.'); });
window.addEventListener('pagehide', () => player.stop('페이지를 벗어나 정지했습니다.'));
