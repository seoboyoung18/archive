import Phaser from 'phaser';
import './style.css';
import { createFighters, stepMovement, movementPose, NEUTRAL, type Fighter } from './combat/movement';
import { FixedStep } from './combat/fixed-step';
import { MovementInput } from './input/movement-input';
import idle0 from '../assets/characters/h1/derived/v2/idle.png?url';
import crouch from '../assets/characters/h1/derived/v2/crouch.png?url';
import idle1 from '../assets/characters/h1/derived/movement-v1/idle-1.png?url';
import walk0 from '../assets/characters/h1/derived/movement-v1/walk-0.png?url';
import walk1 from '../assets/characters/h1/derived/movement-v1/walk-1.png?url';
import walk2 from '../assets/characters/h1/derived/movement-v1/walk-2.png?url';
import walk3 from '../assets/characters/h1/derived/movement-v1/walk-3.png?url';
import jumpRise from '../assets/characters/h1/derived/movement-v1/jump-rise.png?url';
import jumpApex from '../assets/characters/h1/derived/movement-v1/jump-apex.png?url';
import jumpFall from '../assets/characters/h1/derived/movement-v1/jump-fall.png?url';

const assets: Record<string, string> = { 'idle-0': idle0, 'idle-1': idle1, crouch, 'walk-0': walk0, 'walk-1': walk1, 'walk-2': walk2, 'walk-3': walk3, 'jump-rise': jumpRise, 'jump-apex': jumpApex, 'jump-fall': jumpFall };
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
    for (const [key, url] of Object.entries(assets)) this.load.image(key, url);
  }

  create() {
    if (!Object.keys(assets).every(key => this.textures.exists(key))) return;
    const stage = this.add.graphics();
    stage.lineStyle(1, 0x253044, 0.8);
    for (let x = 0; x <= 1280; x += 80) stage.lineBetween(x, 0, x, 720);
    for (let y = 40; y <= 720; y += 80) stage.lineBetween(0, y, 1280, y);
    stage.fillStyle(0x1e2938).fillRect(0, 600, 1280, 120);
    stage.lineStyle(2, 0x71849a).lineBetween(0, 600, 1280, 600);
    stage.lineStyle(2, 0x58657a, 0.6).lineBetween(80, 160, 80, 600).lineBetween(1200, 160, 1200, 600);
    this.add.text(48, 36, 'DIMENSION FIGHT / MOVEMENT', { fontFamily: 'sans-serif', fontSize: '20px', color: '#a3b3c6' });
    this.add.text(48, 656, 'H1    /    WASD', { fontFamily: 'monospace', fontSize: '18px', color: '#a3b3c6' });
    for (let i = 0; i < 2; i++) {
      this.sprites.push(this.add.image(0, 0, 'idle-0').setOrigin(0.5, 0.875).setScale(0.625));
      this.labels.push(this.add.text(0, 0, i === 0 ? 'PLAYER' : 'CPU / TARGET', { fontFamily: 'monospace', fontSize: '16px', color: i === 0 ? '#79e3cb' : '#ffc78d' }).setOrigin(0.5, 1));
    }
    this.guides = this.add.graphics();
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
    status.value = '이동 중'; start.textContent = '계속하기'; start.disabled = true; pauseButton.disabled = false;
    surface.focus();
  }
  private pause() {
    if (!this.ready) return;
    this.paused = true; keyInput.reset(); this.clock.reset();
    start.disabled = false; pauseButton.disabled = true;
    if (this.started) status.value = '일시정지 · 계속하기로 재개';
  }
  private renderFighters() {
    this.guides.clear();
    this.fighters.forEach((f: Fighter, index) => {
      const height = f.state === 'crouch' ? 120 : 220;
      this.sprites[index]!.setTexture(movementPose(f)).setPosition(f.x, f.y).setFlipX(f.facing === -1);
      this.labels[index]!.setPosition(f.x, f.y - (f.state === 'crouch' ? 162 : 255));
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
      this.fighters = stepMovement(this.fighters, [keyInput.sample(), NEUTRAL]); this.ticks++;
    });
    this.renderFighters();
  }
}

retry.addEventListener('click', () => location.reload(), { signal: listeners.signal });
const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: 1280, height: 720, backgroundColor: '#141e2b', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: MovementScene });
if (import.meta.hot) import.meta.hot.dispose(() => { listeners.abort(); game.destroy(true); });
