export type CombatAudioCue = { id: string; key: string };
export interface CombatAudioState {
  enabled: boolean;
  volume: number;
  active: number;
  readyCount: number;
  failedIds: string[];
  contextState: string;
  unlocked: boolean;
  paused: boolean;
  played: number;
  dropped: number;
  lastSound: string | null;
  message: string;
}
type Asset = { bytes: ArrayBuffer | null; buffer: AudioBuffer | null; decoding: boolean };

/** Plays only events that are ready now. Loading and activation never retain combat cues. */
export class CombatAudio {
  private readonly contextFactory: () => AudioContext;
  private readonly onChange: (state: CombatAudioState) => void;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly assets = new Map<string, Asset>();
  private readonly failed = new Set<string>();
  private enabled = true;
  private volume = 0.3;
  private unlocked = false;
  private paused = false;
  private played = 0;
  private dropped = 0;
  private lastSound: string | null = null;
  private message = '시작 또는 소리 켜기에서 효과음을 활성화합니다.';
  private epoch = 0;
  private disposed = false;
  private lastContextState = 'uninitialized';

  constructor(contextFactory: () => AudioContext = () => new AudioContext(),
    onChange: (state: CombatAudioState) => void = () => {}) {
    this.contextFactory = contextFactory;
    this.onChange = onChange;
  }

  get state(): CombatAudioState {
    return { enabled: this.enabled, volume: this.volume, active: this.sources.size,
      readyCount: [...this.assets.values()].filter(asset => asset.buffer !== null).length,
      failedIds: [...this.failed].sort(), contextState: this.context?.state ?? this.lastContextState,
      unlocked: this.unlocked && this.context?.state === 'running', paused: this.paused,
      played: this.played, dropped: this.dropped, lastSound: this.lastSound, message: this.message };
  }

  private publish(message = this.message) {
    this.message = message;
    // A diagnostic UI must not turn an audio failure into a failed combat tick.
    try { this.onChange(this.state); } catch { /* Audio diagnostics are optional. */ }
  }

  private removeSource(source: AudioBufferSourceNode, stop: boolean) {
    this.sources.delete(source);
    source.onended = null;
    if (stop) { try { source.stop(); } catch { /* Already-ended or failed sources can reject stop. */ } }
    try { source.disconnect(); } catch { /* Continue cleaning other nodes. */ }
  }

  private invalidate() {
    this.epoch++;
    this.unlocked = false;
    for (const source of this.sources) this.removeSource(source, true);
  }

  private readonly contextChanged = () => {
    if (this.disposed || !this.context || this.context.state === this.lastContextState) return;
    this.lastContextState = this.context.state;
    if (this.context.state !== 'running') {
      this.invalidate();
      this.publish('오디오가 중단되었습니다. 사용자 조작으로 다시 활성화해 주세요.');
    } else {
      // A browser resuming itself is not permission to restore an invalidated request.
      this.publish();
    }
  };

  private decode(id: string, asset: Asset) {
    const context = this.context;
    if (!context || !asset.bytes || asset.decoding || asset.buffer || this.disposed) return;
    asset.decoding = true;
    const current = () => !this.disposed && this.context === context && this.assets.get(id) === asset;
    const failed = () => {
      if (!current()) return;
      this.assets.delete(id); this.failed.add(id);
      this.publish(`음원 준비 실패: ${id}. 다른 준비된 효과음은 사용할 수 있습니다.`);
    };
    try {
      // Decoding may detach its input. The stored packet is independent of the page's fetch buffer.
      void context.decodeAudioData(asset.bytes.slice(0)).then(buffer => {
        if (!current()) return;
        asset.buffer = buffer; asset.bytes = null; asset.decoding = false;
        this.failed.delete(id);
        this.publish();
      }, failed);
    } catch { failed(); }
  }

  load(id: string, bytes: ArrayBuffer): void {
    if (this.disposed) return;
    const asset: Asset = { bytes: bytes.slice(0), buffer: null, decoding: false };
    this.assets.set(id, asset); this.failed.delete(id);
    this.decode(id, asset);
    this.publish();
  }

  fail(id: string): void {
    if (this.disposed) return;
    this.assets.delete(id); this.failed.add(id);
    this.publish(`음원 준비 실패: ${id}. 다른 준비된 효과음은 사용할 수 있습니다.`);
  }

  async activate(): Promise<void> {
    if (this.disposed || !this.enabled || this.volume === 0) return;
    const token = ++this.epoch;
    this.unlocked = false;
    // Explicit sound controls may prepare audio while gameplay stays paused.
    const current = () => !this.disposed && token === this.epoch && this.enabled && this.volume > 0;
    this.publish('효과음을 활성화하고 있습니다.');
    try {
      if (!this.context) {
        const context = this.contextFactory();
        let gain: GainNode | null = null;
        try {
          gain = context.createGain();
          gain.gain.setValueAtTime(this.volume, context.currentTime);
          gain.connect(context.destination);
          context.addEventListener('statechange', this.contextChanged);
        } catch (error) {
          try { gain?.disconnect(); } catch { /* Release partial setup before retrying. */ }
          try { void context.close().catch(() => {}); } catch { /* No abandoned context on setup failure. */ }
          throw error;
        }
        this.context = context; this.gain = gain;
        this.lastContextState = context.state;
      }
      const context = this.context;
      // Synchronous and before the first await, inside the user's activation gesture.
      const resumed = context.resume();
      for (const [id, asset] of this.assets) this.decode(id, asset);
      await resumed;
      if (!current()) return;
      this.lastContextState = context.state;
      if (context.state !== 'running' || !this.gain) {
        this.invalidate();
        this.publish('효과음을 활성화하지 못했습니다. 다시 눌러 주세요.');
        return;
      }
      this.unlocked = true;
      this.publish('효과음이 활성화되었습니다. 준비된 소리부터 재생합니다.');
    } catch {
      if (!current()) return;
      this.invalidate();
      if (!this.context) this.lastContextState = 'unavailable';
      this.publish('효과음을 활성화하지 못했습니다. 무음으로 계속 진행할 수 있습니다.');
    }
  }

  setPaused(paused: boolean): void {
    if (this.disposed) return;
    this.paused = paused;
    if (paused) this.invalidate();
    this.publish(paused ? '일시정지로 효과음을 비웠습니다.' : '사용자 조작으로 효과음을 다시 활성화해 주세요.');
  }

  beginSession(): void {
    if (this.disposed) return;
    this.invalidate();
    this.played = 0; this.dropped = 0; this.lastSound = null;
    this.publish('새 전투의 효과음을 준비했습니다. 사용자 조작으로 활성화해 주세요.');
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.enabled = enabled;
    if (!enabled) this.invalidate();
    this.publish(enabled ? '효과음 켜짐. 사용자 조작으로 활성화해 주세요.' : '효과음을 껐습니다.');
  }

  setVolume(value: number): void {
    if (this.disposed || !Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    if (this.volume === 0) this.invalidate();
    try { if (this.gain && this.context) this.gain.gain.setValueAtTime(this.volume, this.context.currentTime); }
    catch { this.invalidate(); }
    this.publish(this.volume === 0 ? '음량이 0이어서 효과음을 비웠습니다.'
      : this.unlocked ? '효과음 음량을 변경했습니다.' : '음량을 변경했습니다. 사용자 조작으로 활성화해 주세요.');
  }

  consume(cues: readonly CombatAudioCue[]): void {
    if (this.disposed || !cues.length) return;
    if (this.context && this.context.state !== 'running') this.contextChanged();
    let failedToStart = false;
    for (const cue of cues) {
      const buffer = this.assets.get(cue.id)?.buffer, context = this.context;
      if (!this.enabled || this.volume === 0 || this.paused || !this.unlocked || context?.state !== 'running' || !this.gain || !buffer) {
        this.dropped++;
        continue;
      }
      let source: AudioBufferSourceNode | null = null;
      try {
        source = context.createBufferSource();
        this.sources.add(source);
        source.buffer = buffer;
        source.connect(this.gain);
        const owned = source;
        source.onended = () => {
          if (!this.sources.has(owned)) return;
          this.removeSource(owned, false);
          this.publish();
        };
        source.start(context.currentTime);
        this.played++; this.lastSound = cue.id;
      } catch {
        if (source) this.removeSource(source, true);
        this.dropped++; failedToStart = true;
      }
    }
    this.publish(failedToStart ? '일부 효과음을 재생하지 못했습니다.' : this.message);
  }

  dispose(): void {
    if (this.disposed) return;
    this.invalidate();
    this.disposed = true;
    this.assets.clear(); this.failed.clear();
    this.context?.removeEventListener('statechange', this.contextChanged);
    try { this.gain?.disconnect(); } catch { /* Continue closing the owned context. */ }
    if (this.context) {
      try { void this.context.close().catch(() => {}); } catch { /* Closing must not produce an unhandled failure. */ }
    }
    this.publish('효과음 처리를 종료했습니다.');
  }
}
