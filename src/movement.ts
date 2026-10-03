import Phaser from 'phaser';
import './style.css';
import { createFighters, stepMovement, NEUTRAL } from './combat/movement';
import { createCombat, type CombatState } from './combat/combat.ts';
import { FixedStep } from './combat/fixed-step';
import { MovementInput } from './input/movement-input';
import { H1_ASSETS } from './characters/h1-assets.ts';
import { sampleCombatRender } from './characters/h1-render.ts';
import { applyCombatCamera, configureCombatCameras, H1_CAMERA_MARGIN } from './characters/h1-camera.ts';

const surface = document.querySelector<HTMLDivElement>('#game')!;
const start = document.querySelector<HTMLButtonElement>('#start')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;
const boxes = document.querySelector<HTMLInputElement>('#boxes')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const error = document.querySelector<HTMLParagraphElement>('#error')!;
const retry = document.querySelector<HTMLButtonElement>('#retry')!;
const telemetry = document.querySelector<HTMLParagraphElement>('#telemetry')!;
const listeners = new AbortController();
const keyInput = new MovementInput();

class MovementScene extends Phaser.Scene {
  private fighters = createFighters();
  private readonly displayBase = createCombat();
  private previousCombat: CombatState | null = null;
  private clock = new FixedStep();
  private sprites: Phaser.GameObjects.Image[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private guides!: Phaser.GameObjects.Graphics;
  private ticks = 0;
  private paused = true;
  private ready = false;
  private started = false;

  preload() {
    this.load.on('loaderror', () => {
      error.hidden = false; retry.hidden = false;
      error.textContent = '이동 이미지 로딩에 실패했습니다.';
      status.value = '로딩 실패 · 시작할 수 없음';
    });
    for (const { key, url } of H1_ASSETS) this.load.image(key, url);
  }

  create() {
    if (!H1_ASSETS.every(({ key }) => this.textures.exists(key))) return;
    const stage = this.add.graphics();
    stage.lineStyle(1, 0x253044, 0.8);
    for (let x = 0; x <= 1280; x += 80) stage.lineBetween(x, 0, x, 720);
    for (let y = 40; y <= 720; y += 80) stage.lineBetween(0, y, 1280, y);
    stage.fillStyle(0x1e2938).fillRect(-H1_CAMERA_MARGIN, 600, 1280 + H1_CAMERA_MARGIN * 2, 720);
    stage.lineStyle(2, 0x71849a).lineBetween(-H1_CAMERA_MARGIN, 600, 1280 + H1_CAMERA_MARGIN, 600);
    stage.lineStyle(2, 0x58657a, 0.6).lineBetween(80, 160, 80, 600).lineBetween(1200, 160, 1200, 600);
    const heading = this.add.text(48, 36, 'DIMENSION FIGHT / MOVEMENT', { fontFamily: 'sans-serif', fontSize: '20px', color: '#a3b3c6' });
    const caption = this.add.text(48, 656, 'H1    /    WASD', { fontFamily: 'monospace', fontSize: '18px', color: '#a3b3c6' });
    for (let i = 0; i < 2; i++) {
      this.sprites.push(this.add.image(0, 0, 'idle-0').setOrigin(0.5, 0.875).setScale(0.625));
      this.labels.push(this.add.text(0, 0, i === 0 ? 'PLAYER' : 'CPU / TARGET', { fontFamily: 'monospace', fontSize: '16px', color: i === 0 ? '#79e3cb' : '#ffc78d' }).setOrigin(0.5, 1).setDepth(10));
    }
    this.guides = this.add.graphics().setDepth(10);
    configureCombatCameras(this, [stage, ...this.sprites, ...this.labels, this.guides], [heading, caption]);
    const options = { signal: listeners.signal };
    start.addEventListener('click', () => this.resume(), options);
    pauseButton.addEventListener('click', () => this.pause(), options);
    resetButton.addEventListener('click', () => {
      this.pause(); this.fighters = createFighters(); this.ticks = 0;
      status.value = '초기화 완료 · 계속하기로 시작'; this.renderFighters();
    }, options);
    boxes.addEventListener('change', () => this.renderFighters(), options);
    surface.addEventListener('pointerdown', () => surface.focus(), options);
    surface.addEventListener('blur', () => this.pause(), options);
    window.addEventListener('blur', () => this.pause(), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); }, options);
    window.addEventListener('keydown', event => {
      const focused = document.activeElement === surface;
      if (focused && (event.code === 'Escape' || (event.code === 'Enter' && this.paused))) {
        event.preventDefault();
        if (!event.repeat) { if (this.paused) this.resume(); else this.pause(); }
        return;
      }
      const active = focused && !this.paused;
      if (active && ['KeyW','KeyA','KeyS','KeyD'].includes(event.code)) event.preventDefault();
      keyInput.keyDown(event.code, event.repeat, active);
    }, options);
    window.addEventListener('keyup', event => keyInput.keyUp(event.code), options);
    this.ready = true;
    start.disabled = false; resetButton.disabled = false;
    status.value = '준비 완료 · 이동 시작을 눌러주세요';
    this.renderFighters();
  }

  private resume() {
    if (!this.ready) return;
    keyInput.reset(); this.clock.reset(); this.paused = false; this.started = true;
    this.previousCombat = null;
    status.value = '이동 중'; start.textContent = '계속하기'; start.disabled = true; pauseButton.disabled = false;
    surface.focus();
  }
  private pause() {
    if (!this.ready) return;
    this.paused = true; keyInput.reset(); this.clock.reset();
    this.previousCombat = null;
    start.disabled = false; pauseButton.disabled = true;
    if (this.started) status.value = '일시정지 · 계속하기로 재개';
    this.renderFighters();
  }
  private displayCombat(): CombatState {
    // Movement still runs stepMovement; combat metadata is only a shared artwork/render adapter.
    const fighter = (i: 0 | 1) => ({ ...this.displayBase.fighters[i], ...this.fighters[i],
      posture: this.fighters[i].state === 'crouch' ? 'crouch' as const : 'stand' as const });
    return { ...this.displayBase, frame: this.ticks, fighters: [fighter(0), fighter(1)] };
  }
  private renderFighters() {
    const rendered = sampleCombatRender(this.paused ? null : this.previousCombat, this.displayCombat(), this.clock.alpha);
    applyCombatCamera(this.cameras.main, rendered.camera);
    this.guides.clear();
    rendered.fighters.forEach((f, index) => {
      const height = f.state === 'crouch' ? 120 : 220;
      const visual = rendered.visuals[index]!;
      this.sprites[index]!.setTexture(rendered.poses[index]!).setOrigin(.5, visual.originY).setPosition(visual.x, visual.y)
        .setFlipX(f.facing === -1).setAngle(visual.angle).setDepth(visual.depth);
      this.labels[index]!.setPosition(visual.x, visual.y - visual.labelHeight);
      if (boxes.checked) {
        const color = index === 0 ? 0x70ddc3 : 0xffbf85;
        this.guides.lineStyle(1, color, 0.65).strokeRect(f.x - 36, f.y - height, 72, height);
        this.guides.lineStyle(2, color).lineBetween(f.x - 8, f.y, f.x + 8, f.y).lineBetween(f.x, f.y - 8, f.x, f.y + 8);
      }
    });
    const [p, cpu] = this.fighters;
    telemetry.textContent = `F ${this.ticks} · PLAYER x=${p.x.toFixed(1)}, y=${p.y.toFixed(1)}, vy=${p.vy.toFixed(1)} · ${p.state} · 간격 ${(cpu.x - p.x).toFixed(1)}`;
  }
  update(_time: number, delta: number) {
    if (!this.ready || this.paused) return;
    this.clock.advance(delta, () => {
      this.previousCombat = this.displayCombat();
      this.fighters = stepMovement(this.fighters, [keyInput.sample(), NEUTRAL]); this.ticks++;
    });
    this.renderFighters();
  }
}

retry.addEventListener('click', () => location.reload(), { signal: listeners.signal });
const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: 1280, height: 720, backgroundColor: '#141e2b', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: MovementScene });
if (import.meta.hot) import.meta.hot.dispose(() => { listeners.abort(); game.destroy(true); });
