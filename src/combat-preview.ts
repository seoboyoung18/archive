import Phaser from 'phaser';
import './style.css';
import koArt from '../assets/ui/ko/options-v1/a-impact.png';
import { createCombat, stepCombat, clearComboInputs, attackPhase, worldRect, grabPoseState, COMBAT_NEUTRAL, type CombatInput } from './combat/combat.ts';
import { FixedStep } from './combat/fixed-step.ts';
import { CombatInputBuffer } from './input/combat-input.ts';
import { combatPose, H1_POSES } from './characters/h1-poses.ts';
import { H1_ASSETS } from './characters/h1-assets.ts';
import { combatVisual } from './characters/h1-visual.ts';
import { createCombatAudioControls } from './audio/combat-audio-controls.ts';

const get = <T extends Element>(id: string) => document.querySelector<T>(`#${id}`)!;
const surface = get<HTMLDivElement>('game'), start = get<HTMLButtonElement>('start');
const pauseButton = get<HTMLButtonElement>('pause'), resetButton = get<HTMLButtonElement>('reset');
const targetGrabButton = get<HTMLButtonElement>('target-grab');
const closePracticeButton = get<HTMLButtonElement>('close-practice');
const target = get<HTMLSelectElement>('target'), boxes = get<HTMLInputElement>('boxes');
const status = get<HTMLOutputElement>('status'), error = get<HTMLParagraphElement>('error'), retry = get<HTMLButtonElement>('retry');
const telemetry = get<HTMLParagraphElement>('telemetry'), lastHit = get<HTMLParagraphElement>('last-hit');
const hp = [get<HTMLMeterElement>('player-health'), get<HTMLMeterElement>('cpu-health')];
const hpText = [get<HTMLOutputElement>('player-hp'), get<HTMLOutputElement>('cpu-hp')];
const listeners = new AbortController(), input = new CombatInputBuffer();
const names = ['PLAYER', 'CPU'] as const;
// A real overlapping short tap uses the same public hand interpreter as physical keys.
const grabInput = (): CombatInput => ({ ...COMBAT_NEUTRAL, attacks: ['hp', 'lp'], handEvents: [
  { slot: 'lp', down: true }, { slot: 'hp', down: true }, { slot: 'hp', down: false }, { slot: 'lp', down: false },
] });

class CombatScene extends Phaser.Scene {
  private combat = createCombat();
  private clock = new FixedStep();
  private sprites: Phaser.GameObjects.Image[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private guides!: Phaser.GameObjects.Graphics;
  private paused = true;
  private ready = false;
  private loadFailed = false;
  private koFrame = 0;
  private koBanner!: Phaser.GameObjects.Image;
  private targetGrabQueued = false;
  private targetTechUsed = false;
  private audio = createCombatAudioControls(() => this.pause(), listeners.signal);

  private failLoad() {
    this.loadFailed = true; error.hidden = false; retry.hidden = false;
    error.textContent = '전투 이미지가 누락되었거나 로딩에 실패했습니다.';
    status.value = '로딩 실패 · 시작할 수 없음';
  }
  preload() {
    this.events.once('destroy', () => this.audio.dispose());
    this.load.on('loaderror', () => this.failLoad());
    this.load.image('ko-banner', koArt);
    for (const { key, url } of H1_ASSETS) {
      if (!url) this.failLoad(); else this.load.image(key, url);
    }
  }
  create() {
    if (this.loadFailed || !this.textures.exists('ko-banner') || !Object.keys(H1_POSES).every(key => this.textures.exists(key))) return;
    const stage = this.add.graphics();
    stage.fillStyle(0x1e2938).fillRect(0, 600, 1280, 120);
    stage.lineStyle(1, 0x33445a, 0.5);
    for (let x = 80; x <= 1200; x += 80) stage.lineBetween(x, 150, x, 600);
    stage.lineStyle(2, 0x71849a).lineBetween(0, 600, 1280, 600);
    this.add.text(48, 40, 'DIMENSION FIGHT / COMBAT', { fontFamily: 'sans-serif', fontSize: '20px', color: '#a3b3c6' });
    for (let i = 0; i < 2; i++) {
      this.sprites.push(this.add.image(0, 0, 'idle-0').setOrigin(0.5, 0.875).setScale(0.625));
      this.labels.push(this.add.text(0, 0, i === 0 ? 'PLAYER' : 'CPU / TARGET', { fontFamily: 'monospace', fontSize: '16px', color: i === 0 ? '#79e3cb' : '#ffc78d' }).setOrigin(0.5, 1).setDepth(10));
    }
    this.guides = this.add.graphics().setDepth(10);
    this.koBanner = this.add.image(640, 270, 'ko-banner').setDepth(20).setVisible(false);
    this.koBanner.setScale(640 / this.koBanner.width);
    const options = { signal: listeners.signal };
    start.addEventListener('click', () => this.resume(), options);
    pauseButton.addEventListener('click', () => this.pause(), options);
    resetButton.addEventListener('click', () => {
      this.pause(); this.combat = createCombat(); this.koFrame = 0; this.audio.beginSession();
      this.targetGrabQueued = false; this.targetTechUsed = false;
      lastHit.textContent = '타격 기록 없음'; status.value = '초기화 완료 · 계속하기로 시작'; this.renderCombat();
    }, options);
    closePracticeButton.addEventListener('click', () => {
      this.pause(); this.combat = createCombat(); this.koFrame = 0; this.audio.beginSession();
      this.combat.fighters[0].x = 500; this.combat.fighters[1].x = 584;
      this.targetGrabQueued = false; this.targetTechUsed = false;
      lastHit.textContent = '타격 기록 없음'; status.value = '근접 검수 거리84 · 계속하기로 시작'; this.renderCombat();
    }, options);
    target.addEventListener('change', () => {
      this.pause(); this.targetGrabQueued = false; this.targetTechUsed = false;
      status.value = '표적 입력 변경 · 계속하기로 시작'; this.renderCombat();
    }, options);
    targetGrabButton.addEventListener('click', event => {
      if (event.detail > 1 || !this.canTargetGrab()) return;
      this.pause(); this.targetGrabQueued = true; this.resume(); this.renderCombat();
    }, options);
    boxes.addEventListener('change', () => this.renderCombat(), options);
    surface.addEventListener('pointerdown', () => surface.focus(), options);
    surface.addEventListener('blur', () => this.pause(), options);
    window.addEventListener('blur', () => this.pause(), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); }, options);
    window.addEventListener('keydown', event => {
      const focused = document.activeElement === surface;
      if (focused && (event.code === 'Escape' || (event.code === 'Enter' && this.paused))) {
        event.preventDefault(); if (!event.repeat) { if (this.paused) this.resume(); else this.pause(); } return;
      }
      const active = focused && !this.paused && !this.combat.ended;
      if (active && ['KeyW','KeyA','KeyS','KeyD','KeyU','KeyI','KeyJ','KeyK'].includes(event.code)) event.preventDefault();
      input.keyDown(event.code, event.repeat, active);
    }, options);
    window.addEventListener('keyup', event => input.keyUp(event.code), options);
    this.ready = true; start.disabled = false; resetButton.disabled = false; closePracticeButton.disabled = false; target.disabled = false;
    status.value = '준비 완료 · 전투 시작을 눌러주세요'; this.renderCombat();
  }
  private pause() {
    this.audio.pause();
    if (!this.ready) return;
    this.paused = true; input.reset(); this.clock.reset();
    this.targetGrabQueued = false;
    this.combat = clearComboInputs(this.combat);
    start.disabled = false; pauseButton.disabled = true; status.value = '일시정지 · 계속하기로 재개';
    this.renderCombat();
  }
  private resume() {
    if (!this.ready) return;
    this.paused = false; input.reset(); this.clock.reset();
    this.audio.resume();
    start.textContent = '계속하기'; start.disabled = true; pauseButton.disabled = false;
    status.value = this.combat.ended ? 'K O!! · 검수 초기화로 다시 시작' : '전투 검수 중'; surface.focus();
  }
  private targetInput(): CombatInput {
    const [p, cpu] = this.combat.fighters;
    if (this.targetGrabQueued) { this.targetGrabQueued = false; return grabInput(); }
    // The previous state is H, so the upcoming common tick is the first allowed H+1.
    if (target.value === 'tech' && !this.targetTechUsed && cpu.grab?.kind === 'success'
      && cpu.grab.role === 'target' && cpu.grab.age === 0) {
      this.targetTechUsed = true; return grabInput();
    }
    if (target.value === 'none' || target.value === 'tech') return COMBAT_NEUTRAL;
    return { ...COMBAT_NEUTRAL, axis: cpu.x > p.x ? 1 : -1, crouch: target.value === 'crouch' };
  }
  private canTargetGrab(): boolean {
    const cpu = this.combat.fighters[1];
    return this.ready && !this.combat.ended && !this.targetGrabQueued && cpu.grounded && cpu.action === 'free';
  }
  private renderCombat() {
    this.guides.clear();
    this.koBanner.setVisible(this.combat.ended && this.combat.fighters.some(f => f.hp === 0));
    this.combat.fighters.forEach((f, i) => {
      const def = this.combat.definitions[i];
      const pose = combatPose(f, def, this.koFrame);
      const visual = combatVisual(f, def, this.koFrame);
      this.sprites[i]!.setTexture(pose).setOrigin(0.5, visual.originY).setPosition(visual.x, visual.y)
        .setFlipX(f.facing === -1).setAngle(visual.angle).setDepth(visual.depth);
      this.labels[i]!.setPosition(visual.x, visual.y - visual.labelHeight);
      hp[i]!.value = f.hp; hpText[i]!.value = `${f.hp} / ${def.maxHp}`;
      if (boxes.checked && !this.combat.ended) {
        const color = i === 0 ? 0x70ddc3 : 0xffbf85;
        const hurt = worldRect(def.hurt[f.grounded ? f.posture : 'stand'], f);
        this.guides.lineStyle(1, color, 0.7).strokeRect(hurt.left, hurt.top, hurt.right - hurt.left, hurt.bottom - hurt.top);
        this.guides.lineStyle(2, color).lineBetween(f.x - 8, f.y, f.x + 8, f.y).lineBetween(f.x, f.y - 8, f.x, f.y + 8);
        if (f.attack && attackPhase(f, def) === 'active') {
          const box = worldRect(def.attacks[f.attack.key].box, f);
          this.guides.fillStyle(0xf86b6b, 0.3).fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
        }
      }
    });
    targetGrabButton.disabled = !this.canTargetGrab();
    telemetry.textContent = `F ${this.combat.frame} · 표적 풀기 ${target.value === 'tech' ? this.targetTechUsed ? '1회 사용' : '1회 대기' : '꺼짐'} · ` + this.combat.fighters.map((f, i) =>
      `${i === 0 ? 'PLAYER' : 'CPU'} x=${f.x.toFixed(1)} ${f.action}/${f.posture} ${f.attack ? `${f.attack.key} ${f.attack.age}F ${attackPhase(f, this.combat.definitions[i])}` : ''}`
      + (f.combo ? ` [연계 단계 ${f.combo.step + 1} · 명중 ${f.combo.confirmed ? '확인' : '대기'} · 다음 입력 ${f.combo.queued ? '예약' : '없음'}]` : '')
      + (f.hands.pending ? ` [손 ${f.hands.pending.slot} 조합 대기]` : '')
      + (grabPoseState(f) ? ` [잡기 ${grabPoseState(f)!.kind}/${grabPoseState(f)!.role} ${grabPoseState(f)!.age}F · 대상 ${grabPoseState(f)!.targetPosture}]` : '')).join(' · ');
  }
  update(_time: number, delta: number) {
    if (!this.ready || this.paused) return;
    this.clock.advance(delta, () => {
      if (this.combat.ended) { this.koFrame = Math.min(18, this.koFrame + 1); return; }
      this.combat = stepCombat(this.combat, [input.sample(), this.targetInput()]);
      this.audio.consume(this.combat);
      const events = [
        ...this.combat.events.map(e => `${names[e.attacker]} ${e.key} → ${e.blocked ? '방어 · 피해 0' : `피해 ${e.damage}`}`),
        ...this.combat.grabEvents.map(e => `${names[e.attacker]} → ${names[e.target]} ${e.kind === 'hold' ? '잡기 성공' : e.kind === 'impact' ? '잡기 충격' : '잡기 해제'} · 피해 ${e.damage}`),
      ];
      if (events.length) lastHit.textContent = events.join(' / ');
      if (this.combat.ended) {
        input.reset(); this.targetGrabQueued = false; this.targetTechUsed = false;
        status.value = 'K O!! · 검수 초기화로 다시 시작';
      }
    });
    this.renderCombat();
  }
}
retry.addEventListener('click', () => location.reload(), { signal: listeners.signal });
const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: 1280, height: 720, backgroundColor: '#141e2b', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: CombatScene });
if (import.meta.hot) import.meta.hot.dispose(() => { listeners.abort(); game.destroy(true); });
