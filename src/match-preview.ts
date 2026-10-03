import Phaser from 'phaser';
import './style.css';
import koArt from '../assets/ui/ko/options-v1/a-impact.png';
import { createMatch, startMatch, pauseMatch, nextRound, restartMatch, resultReady, secondsRemaining, type MatchState } from './combat/match.ts';
import { createH1Ai } from './combat/h1-ai.ts';
import { stepH1AiMatch, transitionH1Ai } from './combat/h1-ai-match.ts';
import { FixedStep } from './combat/fixed-step.ts';
import { MatchInputBuffer } from './input/match-input.ts';
import { combatPose } from './characters/h1-poses.ts';
import { H1_ASSETS } from './characters/h1-assets.ts';
import { grabPoseState } from './combat/combat.ts';
import { combatVisual } from './characters/h1-visual.ts';
import { createCombatAudioControls } from './audio/combat-audio-controls.ts';

const get = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const surface = get('game'), status = get('status'), error = get('error');
const start = get<HTMLButtonElement>('start'), resume = get<HTMLButtonElement>('resume'), pause = get<HTMLButtonElement>('pause');
const next = get<HTMLButtonElement>('next'), restart = get<HTMLButtonElement>('restart'), retry = get<HTMLButtonElement>('retry');
const result = get('result'), resultTitle = get('result-title'), resultDetail = get('result-detail'), resultWait = get('result-wait');
const timer = get('timer'), score = get('score'), round = get('round'), telemetry = get('telemetry'), lastHit = get('last-hit');
const health = [get<HTMLMeterElement>('player-health'), get<HTMLMeterElement>('cpu-health')];
const hp = [get('player-hp'), get('cpu-hp')];
const listeners = new AbortController(), input = new MatchInputBuffer();
const names = ['PLAYER', 'CPU'] as const;
const text = (node: HTMLElement, value: string) => { if (node.textContent !== value) node.textContent = value; };

class MatchScene extends Phaser.Scene {
  private match = createMatch();
  private ai = createH1Ai();
  private clock = new FixedStep();
  private ready = false;
  private loadFailed = false;
  private sprites: Phaser.GameObjects.Image[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private koBanner!: Phaser.GameObjects.Image;
  private resultBanner!: Phaser.GameObjects.Text;
  private audio = createCombatAudioControls(() => {
    this.audio.pause();
    if (this.match.phase === 'playing' || (this.match.result && !resultReady(this.match))) this.transition(pauseMatch(this.match, true));
  }, listeners.signal);

  private failLoad() {
    this.loadFailed = true; error.hidden = false; retry.hidden = false;
    text(error, '경기에 필요한 이미지를 불러오지 못했습니다. 다시 불러오기를 눌러주세요.');
    text(status, '로딩 실패 · 다시 불러오기를 눌러주세요');
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
    if (this.loadFailed) return;
    if (!this.textures.exists('ko-banner') || H1_ASSETS.some(({key}) => !this.textures.exists(key))) { this.failLoad(); return; }
    const stage = this.add.graphics();
    stage.fillStyle(0x1e2938).fillRect(0, 600, 1280, 120);
    stage.lineStyle(1, 0x33445a, 0.5);
    for (let x = 80; x <= 1200; x += 80) stage.lineBetween(x, 150, x, 600);
    stage.lineStyle(2, 0x71849a).lineBetween(0, 600, 1280, 600);
    this.add.text(48, 40, 'DIMENSION FIGHT / FIRST TO TWO', { fontFamily: 'sans-serif', fontSize: '20px', color: '#a3b3c6' });
    for (let i = 0; i < 2; i++) {
      this.sprites.push(this.add.image(0, 0, 'idle-0').setOrigin(0.5, 0.875).setScale(0.625));
      this.labels.push(this.add.text(0, 0, i === 0 ? 'PLAYER' : 'CPU / AI', { fontFamily: 'monospace', fontSize: '16px', color: i === 0 ? '#79e3cb' : '#ffc78d' }).setOrigin(0.5, 1).setDepth(10));
    }
    this.koBanner = this.add.image(640, 270, 'ko-banner').setDepth(20).setVisible(false);
    this.koBanner.setScale(640 / this.koBanner.width);
    this.resultBanner = this.add.text(640, 270, '', { fontFamily: 'sans-serif', fontSize: '64px', fontStyle: 'bold', color: '#ffe1a3', stroke: '#141e2b', strokeThickness: 8 }).setOrigin(0.5).setDepth(20);
    const options = { signal: listeners.signal };
    const button = (node: HTMLButtonElement, action: () => void) => node.addEventListener('click', event => {
      if (event.detail <= 1 && !node.disabled) action();
    }, options);
    button(start, () => this.transition(startMatch(this.match)));
    button(resume, () => this.transition(pauseMatch(this.match, false)));
    button(pause, () => this.transition(pauseMatch(this.match, true)));
    button(next, () => this.transition(nextRound(this.match)));
    button(restart, () => this.transition(restartMatch(this.match)));
    surface.addEventListener('pointerdown', () => surface.focus(), options);
    surface.addEventListener('blur', () => {
      this.audio.pause();
      // Finished results remain navigable by Tab without demanding another resume.
      if (this.match.phase === 'playing' || (this.match.result && !resultReady(this.match))) this.transition(pauseMatch(this.match, true));
    }, options);
    window.addEventListener('blur', () => { this.audio.pause(); this.transition(pauseMatch(this.match, true)); }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.audio.pause(); this.transition(pauseMatch(this.match, true)); } }, options);
    window.addEventListener('keydown', event => {
      const focused = document.activeElement === surface;
      const playing = this.match.phase === 'playing' && !this.match.paused;
      if (focused && ['KeyW','KeyA','KeyS','KeyD','KeyU','KeyI','KeyJ','KeyK','Enter','Escape','KeyR'].includes(event.code)) event.preventDefault();
      // Native button auto-repeat must not start the next state after a held Enter.
      if (event.repeat && ['Enter','Space'].includes(event.code) && document.activeElement instanceof HTMLButtonElement) event.preventDefault();
      const shortcut = input.keyDown(event.code, event.repeat, focused, playing);
      if (shortcut === 'Escape') this.transition(pauseMatch(this.match, !this.match.paused));
      if (shortcut === 'Enter') {
        if (this.match.paused) this.transition(pauseMatch(this.match, false));
        else if (this.match.phase === 'ready') this.transition(startMatch(this.match));
        else this.transition(nextRound(this.match));
      }
      if (shortcut === 'KeyR') this.transition(restartMatch(this.match));
    }, options);
    window.addEventListener('keyup', event => input.keyUp(event.code), options);
    this.ready = true; this.renderMatch();
  }
  private transition(nextState: MatchState) {
    if (!this.ready || nextState === this.match) return;
    const previous = this.match;
    this.ai = transitionH1Ai(this.ai, previous, nextState);
    this.match = nextState; input.reset(); this.clock.reset();
    if (nextState.combat !== previous.combat && nextState.combat.frame === 0) { text(lastHit, '타격 기록 없음'); this.audio.beginSession(); }
    if (nextState.paused || nextState.phase === 'ready') this.audio.pause();
    else this.audio.resume();
    this.renderMatch();
    if (!nextState.paused) surface.focus();
  }
  private renderMatch() {
    const s = this.match, ended = s.result !== null, available = resultReady(s);
    this.match.combat.fighters.forEach((f, i) => {
      const def = s.combat.definitions[i], visual = combatVisual(f, def);
      this.sprites[i]!.setTexture(combatPose(f, def, s.resultAge)).setOrigin(0.5, visual.originY)
        .setPosition(visual.x, visual.y).setFlipX(f.facing === -1).setAngle(visual.angle).setDepth(visual.depth);
      this.labels[i]!.setPosition(visual.x, visual.y - visual.labelHeight);
      health[i]!.value = f.hp; text(hp[i]!, `${f.hp} / ${def.maxHp}`);
    });
    text(round, `ROUND ${s.round}`); text(timer, String(secondsRemaining(s))); text(score, `${s.wins[0]} : ${s.wins[1]}`);
    start.hidden = s.phase !== 'ready'; start.disabled = !this.ready;
    resume.hidden = !s.paused; pause.disabled = s.phase === 'ready' || s.paused;
    next.hidden = s.phase !== 'round-result'; next.disabled = !available;
    text(next, s.result?.winner === null ? '같은 라운드 재경기' : '다음 라운드');
    restart.hidden = s.phase !== 'match-result'; restart.disabled = !available;
    result.hidden = !ended;
    const reason = s.result?.reason;
    this.koBanner.setVisible(reason === 'ko');
    this.resultBanner.setText(reason === 'double-ko' ? 'DOUBLE KO' : reason?.startsWith('timeout') ? 'TIME UP' : '');
    if (s.result) {
      const winner = s.result.winner;
      text(resultTitle, s.phase === 'match-result' ? winner === 0 ? '승리!' : '패배'
        : winner === null ? '같은 라운드 재경기' : `${names[winner]} 라운드 승리`);
      const explanation = reason === 'double-ko' ? '동시 KO · 승수 유지'
        : reason === 'timeout-tie' ? 'TIME UP · 체력 동일 · 승수 유지'
        : `${reason === 'ko' ? 'K O!!' : 'TIME UP · 체력 우세'} · ${names[winner!]} ${s.phase === 'match-result' ? '경기' : '라운드'} 승리`;
      text(resultDetail, `${explanation} · ${s.wins[0]} : ${s.wins[1]}`);
      text(resultWait, s.paused ? '일시정지 · 계속하기로 재개하세요.' : available
        ? s.phase === 'match-result' ? 'R 또는 버튼으로 경기 전체를 초기화합니다.' : 'Enter 또는 버튼으로 진행하세요.'
        : '쓰러짐 연출 중');
    }
    text(status, s.paused ? '일시정지 · 계속하기로 재개' : s.phase === 'ready' ? '준비 완료 · 경기 시작 또는 Enter'
      : s.phase === 'playing' ? '경기 진행 중' : `${resultTitle.textContent} · ${available ? '진행 가능' : '쓰러짐 연출 중'}`);
    text(telemetry, `F ${s.combat.frame} · 남은 ${s.remainingFrames}F · 결과 연출 ${s.resultAge}F · ` + s.combat.fighters.map((f,i) =>
      `${names[i]} x=${f.x.toFixed(1)} ${f.action}/${f.posture} ${f.attack ? `${f.attack.key} ${f.attack.age}F` : ''}`
      + (f.combo ? ` [연계 단계 ${f.combo.step + 1} · 명중 ${f.combo.confirmed ? '확인' : '대기'} · 다음 입력 ${f.combo.queued ? '예약' : '없음'}]` : '')
      + (f.hands.pending ? ` [손 ${f.hands.pending.slot} 조합 대기]` : '')
      + (grabPoseState(f) ? ` [잡기 ${grabPoseState(f)!.kind}/${grabPoseState(f)!.role} ${grabPoseState(f)!.age}F · 대상 ${grabPoseState(f)!.targetPosture}]` : '')).join(' · ')
      + ` · CPU 다음 잡기까지 ${this.ai.grabCooldown}F · 잡힘 관찰 ${this.ai.captureCount}회 · 다음 잡힘 ${this.ai.captureCount % 2 === 0 ? '메치기 허용' : '풀기 시도'}`);
  }
  update(_time: number, delta: number) {
    if (!this.ready || this.match.paused || this.match.phase === 'ready') return;
    this.clock.advance(delta, () => {
      const previous = this.match;
      const next = stepH1AiMatch(previous, this.ai, input.sample());
      this.match = next.match; this.ai = next.ai;
      if (this.match.combat.frame !== previous.combat.frame) {
        this.audio.consume(this.match.combat);
        const events = [
          ...this.match.combat.events.map(e => `${names[e.attacker]} ${e.key} → ${e.blocked ? '방어 · ' : ''}피해 ${e.damage}`),
          ...this.match.combat.grabEvents.map(e => `${names[e.attacker]} → ${names[e.target]} ${e.kind === 'hold' ? '잡기 성공' : e.kind === 'impact' ? '잡기 충격' : '잡기 해제'} · 피해 ${e.damage}`),
        ];
        if (events.length) text(lastHit, events.join(' / '));
      }
      if (this.match.phase !== previous.phase) { input.reset(); this.clock.reset(); }
    });
    this.renderMatch();
  }
}
retry.addEventListener('click', () => location.reload(), { signal: listeners.signal });
const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: 1280, height: 720, backgroundColor: '#141e2b', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: MatchScene });
if (import.meta.hot) import.meta.hot.dispose(() => { listeners.abort(); game.destroy(true); });
