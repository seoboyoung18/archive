import Phaser from 'phaser';
import './style.css';
import idle from '../assets/characters/h1/derived/v1/idle.png?url';
import startup from '../assets/characters/h1/derived/v1/startup.png?url';
import active from '../assets/characters/h1/derived/v1/active.png?url';
import recovery from '../assets/characters/h1/derived/v1/recovery.png?url';

const textures = { idle, startup, active, recovery };
type Pose = keyof typeof textures;
const labels: Record<Pose, string> = { idle: '대기', startup: '약손 · 준비 6F', active: '약손 · 유효 3F', recovery: '약손 · 회복 15F' };
const select = document.querySelector<HTMLSelectElement>('#pose')!;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const flip = document.querySelector<HTMLButtonElement>('#flip')!;
const boxes = document.querySelector<HTMLInputElement>('#boxes')!;
const label = document.querySelector<HTMLOutputElement>('#frame-label')!;
const error = document.querySelector<HTMLParagraphElement>('#error')!;
const controls = [select, play, flip, boxes];
controls.forEach(control => { control.disabled = true; });
const listeners = new AbortController();

class Preview extends Phaser.Scene {
  private sprite!: Phaser.GameObjects.Image;
  private guides!: Phaser.GameObjects.Graphics;
  private pose: Pose = 'idle';
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
    select.addEventListener('change', () => { this.stop(); this.show(select.value as Pose); }, options);
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
  }

  private stop() {
    this.playing = false;
    play.textContent = '약손 재생';
    play.setAttribute('aria-pressed', 'false');
  }

  private show(pose: Pose) {
    this.pose = pose;
    this.sprite.setTexture(pose);
    select.value = pose;
    label.value = labels[pose];
    this.drawGuides();
  }

  private drawGuides() {
    const g = this.guides.clear();
    if (!boxes.checked) return;
    g.fillStyle(0x7cb5ff, 0.1).fillRect(604, 380, 72, 220);
    g.lineStyle(2, 0x7cb5ff, 0.8).strokeRect(604, 380, 72, 220);
    if (this.pose === 'active') {
      const x = this.left ? 640 - 104 : 640 + 36;
      g.fillStyle(0xff667c, 0.18).fillRect(x, 410, 68, 90);
      g.lineStyle(2, 0xff667c, 1).strokeRect(x, 410, 68, 90);
    }
    g.lineStyle(2, 0x70e0c6, 1).lineBetween(628, 600, 652, 600).lineBetween(640, 588, 640, 612);
    g.strokeCircle(640, 600, 5);
  }

  update(_time: number, delta: number) {
    if (!this.playing) return;
    // 24 attack ticks followed by 30 idle ticks, only for this asset inspector.
    this.elapsed = (this.elapsed + delta) % 900;
    const tick = Math.floor(this.elapsed * 60 / 1000);
    const next: Pose = tick < 6 ? 'startup' : tick < 9 ? 'active' : tick < 24 ? 'recovery' : 'idle';
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
