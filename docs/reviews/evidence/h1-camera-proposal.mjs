import { createCombat, stepCombat, COMBAT_NEUTRAL as N } from '../../../src/combat/combat.ts';
import { STAGE } from '../../../src/combat/movement.ts';
import { combatVisual as rawVisual, combatVisuals } from '../../../src/characters/h1-visual.ts';
import { combatCamera, worldToScreen, H1_CAMERA_MARGIN } from '../../../src/characters/h1-camera.ts';
import { combatVisuals as previousVisuals } from './h1-camera-previous.mjs';

// A is the approved product camera. Only the unselected B formula lives in this evidence module.
export { rawVisual, H1_CAMERA_MARGIN };
export const transformPoint = worldToScreen;

export function cameraFor(combat, mode = 'distance') {
  if (!['current', 'distance', 'fixed'].includes(mode)) throw new Error(`Unknown camera mode: ${mode}`);
  if (mode === 'distance') return { ...combatCamera(combat), mode, margin: H1_CAMERA_MARGIN };
  if (mode === 'current') return { mode, margin: H1_CAMERA_MARGIN, zoom: 1, offsetX: 0, scrollX: 0, scrollY: 0 };
  const left = STAGE.minX - H1_CAMERA_MARGIN, right = STAGE.maxX + H1_CAMERA_MARGIN;
  const zoom = Math.min(1, 1280 / (right - left));
  const screenLeft = 640 + (left - 640) * zoom, screenRight = 640 + (right - 640) * zoom;
  const offsetX = Math.max(-screenLeft, Math.min(1280 - screenRight, 0));
  return { mode, margin: H1_CAMERA_MARGIN, left, right, zoom, offsetX, scrollX: -offsetX / zoom, scrollY: 0 };
}

export function proposalVisuals(combat, mode, koFrame = 0) {
  return { camera: cameraFor(combat, mode), visuals: mode === 'current'
    ? previousVisuals(combat, koFrame) : combatVisuals(combat, koFrame) };
}

const chord = () => ({ ...N, attacks: ['lp', 'hp'], handEvents: [
  { slot: 'lp', down: true }, { slot: 'hp', down: true }, { slot: 'hp', down: false }, { slot: 'lp', down: false },
] });

/** Only initial positions are assigned. Every later state comes from public combat input. */
export function buildScenario(kind, side = 'left', attackKey = 'stand-hk') {
  let s = createCombat();
  const direction = side === 'left' ? 1 : -1, corner = side === 'left' ? STAGE.minX : STAGE.maxX;
  const far = kind.startsWith('far-'), grabbing = kind.startsWith('grab'), attack = s.definitions[0].attacks[attackKey];
  if (!attack) throw new Error(`Unknown attack: ${attackKey}`);
  s.fighters[0].x = far && kind !== 'far-travel' ? STAGE.minX : corner;
  s.fighters[1].x = kind === 'far-travel' ? (side === 'left' ? STAGE.maxX : STAGE.minX)
    : far ? STAGE.maxX : corner + direction * (grabbing ? 84 : 160);
  const crouching = kind === 'far-attacks' && attackKey.startsWith('crouch-');
  const neutral = { ...N, crouch: crouching };
  s = stepCombat(s, [neutral, neutral]);
  const frames = [{ combat: s, koFrame: 0, label: '초기 배치 · 공통 중립 틱 후' }], markers = [];
  const mark = label => markers.push({ frame: frames.length - 1, label });
  const tick = (a = neutral, b = neutral, label = '') => {
    const wasEnded = s.ended; s = stepCombat(s, [a, b]);
    frames.push({ combat: s, koFrame: wasEnded ? Math.min(18, frames.at(-1).koFrame + 1) : 0, label });
  };
  mark('시작');
  if (kind === 'transition') {
    for (let i = 0; i < 48; i++) { tick({ ...N, axis: -direction }, N, '벽으로 후진 · 이동은 경계에서 멈춤'); if (i === 0) mark('후진 시작'); }
    mark('후진 48F'); tick(N, N, '후진 → 대기'); mark('대기 전환');
    for (let i = 0; i < 14; i++) tick(N, N, '대기');
    tick({ ...N, jump: true }, N, '대기 → 제자리 점프'); mark('점프 시작');
    for (let i = 0; !s.fighters[0].grounded && i < 120; i++) tick(N, N, '제자리 점프');
    if (!s.fighters[0].grounded) throw new Error('Fixture jump did not land');
    mark('착지');
    for (let i = 0; i < 15; i++) tick(N, N, '착지 후 대기');
    tick({ ...N, attacks: ['hk'] }, N, '대기 → 선 K'); mark('K 시작');
    const rule = s.definitions[0].attacks['stand-hk'];
    for (let age = 1; age <= rule.startup + rule.active + rule.recovery; age++) {
      tick(N, N, '선 K · 거리160에서 실제 공통 타격');
      if (s.fighters[0].attack?.age === rule.startup) mark('K 발끝 유효');
      if (s.fighters[0].attack?.age === rule.startup + rule.active) mark('K 회복');
    }
    mark('K → 대기'); for (let i = 0; i < 15; i++) tick(N, N, '공격 후 대기');
  } else if (grabbing) {
    tick(chord(), N, '공통 U+I 잡기 시도'); mark('잡기 시도');
    let escaped = false;
    for (let i = 0; i < 94; i++) {
      const tech = kind === 'grab-tech' && !escaped && s.fighters[1].grab?.kind === 'success' && s.fighters[1].grab.age === 11;
      tick(N, tech ? chord() : N, tech ? 'H12에 새 U+I · 실제 공통 풀기' : '거리84 잡기 · 회전·충돌·개별 복귀');
      if (tech) { escaped = true; mark('H12 풀기 T0'); }
      const age = s.grabPair?.age;
      if ([0, 13, 20, 36, 53, 54, 71].includes(age)) mark(`잡기 H${age}`);
      if (!escaped && frames.at(-2).combat.grabPair && !s.grabPair) mark('대상 H72 복귀');
      if (escaped && frames.at(-2).combat.fighters[0].grab && !s.fighters[0].grab) mark('풀기 T12 복귀');
    }
  } else if (kind === 'far-travel') {
    const distance = () => Math.abs(s.fighters[1].x - s.fighters[0].x);
    mark(`양끝 ${distance()}`);
    for (let i = 0; distance() > STAGE.gap && i < 300; i++) {
      const before = distance(); tick({ ...N, axis: direction }, N, '양끝 → 접근 · PLAYER만 전진');
      if (before > 896 && distance() <= 896) mark(`접근 거리 ${distance()} · A 100%`);
      if (before > STAGE.gap && distance() === STAGE.gap) mark(`근접 거리 ${distance()}`);
    }
    if (distance() !== STAGE.gap) throw new Error('Travel fixture did not reach the common collision gap');
    for (let i = 0; i < 15; i++) { tick(N, N, '근접 정지'); if (i === 0) mark('근접 정지'); }
    for (let i = 0; distance() < STAGE.maxX - STAGE.minX && i < 300; i++) {
      const before = distance(); tick({ ...N, axis: -direction }, N, '접근 → 후퇴 · PLAYER만 후진');
      if (before < 896 && distance() >= 896) mark(`후퇴 거리 ${distance()} · A 축소 경계`);
      if (before < STAGE.maxX - STAGE.minX && distance() === STAGE.maxX - STAGE.minX) mark(`양끝 거리 ${distance()}`);
    }
    if (distance() !== STAGE.maxX - STAGE.minX) throw new Error('Travel fixture did not return to the stage edges');
    tick(N, N, '양끝 정지'); mark('양끝 정지');
  } else if (kind === 'far-idle') {
    for (let i = 0; i < 30; i++) { tick(N, N, '양끝80/1200 · 정지'); if (i === 14) mark('대기 두 번째 그림'); }
  } else if (kind === 'far-attacks') {
    const slot = attackKey.split('-')[1];
    tick({ ...neutral, attacks: [slot] }, { ...neutral, attacks: [slot] }, `양끝 · ${attackKey}`); mark('공격 시작');
    for (let age = 1; age <= attack.startup + attack.active + attack.recovery; age++) {
      tick(neutral, neutral, `양끝 · ${attackKey}`);
      if (s.fighters[0].attack?.age === attack.startup) mark('유효 시작');
      if (s.fighters[0].attack?.age === attack.startup + attack.active) mark('회복 시작');
    }
    mark('공격 → 대기'); for (let i = 0; i < 15; i++) tick(neutral, neutral, '공격 후 대기');
  } else throw new Error(`Unknown scenario: ${kind}`);
  return { frames, markers };
}
