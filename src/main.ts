import Phaser from 'phaser';
import './style.css';
import idle from '../assets/characters/h1/derived/v2/idle.png?url';
import startup from '../assets/characters/h1/derived/v2/startup.png?url';
import active from '../assets/characters/h1/derived/v2/active.png?url';
import recovery from '../assets/characters/h1/derived/v2/recovery.png?url';
import crouch from '../assets/characters/h1/derived/v2/crouch.png?url';
import crouchStartup from '../assets/characters/h1/derived/v2/crouch-startup.png?url';
import crouchActive from '../assets/characters/h1/derived/v2/crouch-active.png?url';
import crouchRecovery from '../assets/characters/h1/derived/v2/crouch-recovery.png?url';
import { phaseAtTick, type Phase } from './preview-timing';

const textures = { idle, startup, active, recovery, crouch, crouchStartup, crouchActive, crouchRecovery };
const moves = {
  punch: { name: '선 약손', base: '대기', frames: [6, 3, 15], hurtHeight: 220, hit: [36, -190, 68, 90],
    textures: { idle: 'idle', startup: 'startup', active: 'active', recovery: 'recovery' } },
  crouchKick: { name: '앉은 약발', base: '앉기', frames: [8, 4, 18], hurtHeight: 120, hit: [36, -60, 88, 50],
    textures: { idle: 'crouch', startup: 'crouchStartup', active: 'crouchActive', recovery: 'crouchRecovery' } },
} as const;
type Move = keyof typeof moves;
const phaseNames = { idle: '기본 자세', startup: '준비', active: '유효', recovery: '회복' };
const moveSelect = document.querySelector<HTMLSelectElement>('#move')!;
const select = document.querySelector<HTMLSelectElement>('#pose')!;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const flip = document.querySelector<HTMLButtonElement>('#flip')!;
const boxes = document.querySelector<HTMLInputElement>('#boxes')!;
const label = document.querySelector<HTMLOutputElement>('#frame-label')!;
const error = document.querySelector<HTMLParagraphElement>('#error')!;
const controls = [moveSelect, select, play, flip, boxes];
controls.forEach(control => { control.disabled = true; });
const listeners = new AbortController();

class Preview extends Phaser.Scene {
  private sprite!: Phaser.GameObjects.Image;
  private guides!: Phaser.GameObjects.Graphics;
  private pose: Phase = 'idle';
  private move: Move = 'punch';
  private playing = false;
  private elapsed = 0;
  private left = false;

  preload() {
    this.load.on('loaderror', () => {
      error.hidden = false;
      error.textContent = '이미지를 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
    });
    for (const [key, url] of Object.entries(textures)) this.load.image(key, url);
  }

  create() {
    if (!Object.keys(textures).every(key => this.textures.exists(key))) return;
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x252e3c, 0.6);
    for (let x = 0; x <= 1280; x += 40) grid.lineBetween(x, 0, x, 720);
    for (let y = 0; y <= 720; y += 40) grid.lineBetween(0, y, 1280, y);
    grid.lineStyle(2, 0x8295ab, 0.6).lineBetween(0, 600, 1280, 600);
    this.add.text(48, 44, 'H1 / ANIMATION DRAFT', { fontFamily: 'sans-serif', fontSize: '20px', color: '#99a9ba' });
    this.add.text(48, 638, '1280 × 720    /    ROOT (640, 600)    /    SCALE 0.625', { fontFamily: 'monospace', fontSize: '16px', color: '#99a9ba' });
    this.sprite = this.add.image(640, 600, 'idle').setOrigin(0.5, 0.875).setScale(0.625);
    this.guides = this.add.graphics();
    const options = { signal: listeners.signal };
    moveSelect.addEventListener('change', () => {
      this.move = moveSelect.value as Move;
      this.stop();
      this.show('idle');
      this.updateDescription();
    }, options);
    select.addEventListener('change', () => { this.stop(); this.show(select.value as Phase); }, options);
    play.addEventListener('click', () => {
      if (this.playing) this.stop();
      else { this.playing = true; this.elapsed = 0; play.textContent = '재생 정지'; play.setAttribute('aria-pressed', 'true'); this.show('startup'); }
    }, options);
    flip.addEventListener('click', () => {
      this.left = !this.left;
      this.sprite.setFlipX(this.left);
      flip.textContent = this.left ? '오른쪽 보기' : '왼쪽 보기';
      flip.setAttribute('aria-pressed', String(this.left));
      this.drawGuides();
    }, options);
    boxes.addEventListener('change', () => this.drawGuides(), options);
    window.addEventListener('blur', () => this.stop(), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); }, options);
    controls.forEach(control => { control.disabled = false; });
    this.show('idle');
    this.updateDescription();
  }

  private stop() {
    this.playing = false;
    play.textContent = `${moves[this.move].name} 재생`;
    play.setAttribute('aria-pressed', 'false');
  }

  private updateDescription() {
    const data = moves[this.move];
    document.querySelector('#timing')!.textContent = `${data.frames.join(' / ')} F`;
    document.querySelector('#timing-summary')!.textContent = `준비 → 유효 → 회복. 초당 60회 기준으로 총 ${data.frames.reduce((a, b) => a + b, 0) / 60}초입니다. 반복 사이에는 ${data.base}를 30F 표시합니다.`;
    select.options[0]!.textContent = data.base;
  }

  private show(pose: Phase) {
    this.pose = pose;
    const data = moves[this.move];
    this.sprite.setTexture(data.textures[pose]);
    select.value = pose;
    const phaseIndex = ['startup', 'active', 'recovery'].indexOf(pose);
    label.value = pose === 'idle' ? data.base : `${data.name} · ${phaseNames[pose]} ${data.frames[phaseIndex]}F`;
    this.drawGuides();
  }

  private drawGuides() {
    const g = this.guides.clear();
    if (!boxes.checked) return;
    const data = moves[this.move];
    g.fillStyle(0x7cb5ff, 0.1).fillRect(604, 600 - data.hurtHeight, 72, data.hurtHeight);
    g.lineStyle(2, 0x7cb5ff, 0.8).strokeRect(604, 600 - data.hurtHeight, 72, data.hurtHeight);
    if (this.pose === 'active') {
      const [hx, hy, width, height] = data.hit;
      const x = 640 + (this.left ? -hx - width : hx);
      g.fillStyle(0xff667c, 0.18).fillRect(x, 600 + hy, width, height);
      g.lineStyle(2, 0xff667c, 1).strokeRect(x, 600 + hy, width, height);
    }
    g.lineStyle(2, 0x70e0c6, 1).lineBetween(628, 600, 652, 600).lineBetween(640, 588, 640, 612);
    g.strokeCircle(640, 600, 5);
  }

  update(_time: number, delta: number) {
    if (!this.playing) return;
    const frames = moves[this.move].frames;
    // Idle gap is only for this inspector, not a combat recovery rule.
    const cycleTicks = frames.reduce((a, b) => a + b, 30);
    this.elapsed = (this.elapsed + delta) % (cycleTicks * 1000 / 60);
    const tick = Math.floor(this.elapsed * 60 / 1000);
    const next = phaseAtTick(tick, frames);
    if (next !== this.pose) this.show(next);
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#151b25',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: Preview,
});
if (import.meta.hot) import.meta.hot.dispose(() => { listeners.abort(); game.destroy(true); });
