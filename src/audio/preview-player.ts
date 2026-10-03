export type PreviewCue = { id: string; at: number };
export interface PreviewState {
  status: 'idle' | 'preparing' | 'playing' | 'stopped' | 'error';
  message: string;
  active: number;
  contextState: string;
}

/** Owns only the standalone listening preview, never combat events or time. */
export class PreviewPlayer {
  private readonly contextFactory: () => AudioContext;
  private readonly onChange: (state: PreviewState) => void;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly decoded = new Map<string, Promise<AudioBuffer>>();
  private volume = 0.3;
  private epoch = 0;
  private disposed = false;
  private lastContextState = 'uninitialized';
  private current: PreviewState = {
    status: 'idle', message: '들을 소리를 선택해 주세요.', active: 0, contextState: 'uninitialized',
  };

  constructor(contextFactory: () => AudioContext = () => new AudioContext(),
    onChange: (state: PreviewState) => void = () => {}) {
    this.contextFactory = contextFactory;
    this.onChange = onChange;
  }

  get state(): PreviewState {
    return { ...this.current, active: this.sources.size, contextState: this.context?.state ?? 'uninitialized' };
  }

  private publish(status: PreviewState['status'], message: string) {
    this.current = { status, message, active: this.sources.size, contextState: this.context?.state ?? 'uninitialized' };
    this.onChange(this.state);
  }

  private readonly contextChanged = () => {
    if (this.disposed || !this.context) return;
    if (this.context.state === this.lastContextState) return;
    this.lastContextState = this.context.state;
    if (this.context.state !== 'running' && ['preparing', 'playing'].includes(this.current.status)) {
      this.stop('오디오가 중단되어 소리와 예약을 비웠습니다. 다시 눌러 재생해 주세요.');
    } else this.publish(this.current.status, this.current.message);
  };

  private clearSources() {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* A failed or already-ended source may not accept stop. */ }
      try { source.disconnect(); } catch { /* Cleanup must continue for the remaining sources. */ }
    }
    this.sources.clear();
  }

  setVolume(value: number) {
    if (this.disposed || !Number.isFinite(value)) return;
    const previousVolume = this.volume;
    this.volume = Math.max(0, Math.min(1, value));
    if (this.gain && this.context) this.gain.gain.setValueAtTime(this.volume, this.context.currentTime);
    if (this.volume === 0) this.stop('음량이 0이어서 소리와 예약을 비웠습니다.');
    else if (previousVolume === 0) this.publish('stopped', '음량을 복원했습니다. 다시 눌러 재생해 주세요.');
  }

  stop(message = '재생과 예약을 모두 정지했습니다.') {
    if (this.disposed) return;
    this.epoch++;
    this.clearSources();
    this.publish('stopped', message);
  }

  async play(cues: readonly PreviewCue[], audio: ReadonlyMap<string, ArrayBuffer>): Promise<void> {
    if (this.disposed) return;
    const token = ++this.epoch;
    this.clearSources();
    if (this.volume === 0) {
      this.publish('stopped', '음량이 0입니다. 음량을 올린 뒤 다시 눌러 주세요.');
      return;
    }
    if (!cues.length) { this.publish('idle', '선택된 소리가 없습니다.'); return; }
    if (cues.some(cue => !cue.id || !Number.isFinite(cue.at) || cue.at < 0)) {
      this.publish('error', '선택한 소리의 재생 시점이 올바르지 않습니다.');
      return;
    }
    const selected = cues.map(cue => ({ ...cue }));
    const isCurrent = () => !this.disposed && this.epoch === token && this.volume > 0;
    this.publish('preparing', '선택한 소리를 준비하고 있습니다.');
    try {
      if (!this.context) {
        this.context = this.contextFactory();
        this.lastContextState = this.context.state;
        this.context.addEventListener('statechange', this.contextChanged);
        this.gain = this.context.createGain();
        this.gain.gain.setValueAtTime(this.volume, this.context.currentTime);
        this.gain.connect(this.context.destination);
      }
      const context = this.context;
      // This call must remain before the first await, inside the user's click/keyboard gesture.
      await context.resume();
      if (!isCurrent()) return;
      this.lastContextState = context.state;
      if (context.state !== 'running') {
        this.publish('error', '오디오를 활성화하지 못했습니다. 다시 눌러 주세요.');
        return;
      }
      const buffers = new Map<string, AudioBuffer>();
      const skipped: string[] = [];
      await Promise.all([...new Set(selected.map(cue => cue.id))].map(async id => {
        const bytes = audio.get(id);
        if (!bytes) { skipped.push(id); return; }
        try {
          let pending = this.decoded.get(id);
          if (!pending) {
            // Web Audio may detach its input; keep the page's fetched packet reusable.
            pending = context.decodeAudioData(bytes.slice(0));
            this.decoded.set(id, pending);
            void pending.catch(() => {
              if (this.decoded.get(id) === pending) this.decoded.delete(id);
            });
          }
          buffers.set(id, await pending);
        } catch { skipped.push(id); }
      }));
      if (!isCurrent()) return;
      if (context.state !== 'running') {
        this.stop('오디오가 중단되어 준비한 소리를 폐기했습니다. 다시 눌러 주세요.');
        return;
      }
      const playable = selected.filter(cue => buffers.has(cue.id));
      const warning = skipped.length ? ` 준비 실패로 생략한 음원: ${skipped.join(', ')}.` : '';
      if (!playable.length) {
        this.publish('error', `선택한 음원을 준비하지 못했습니다.${warning}`);
        return;
      }
      const baseTime = context.currentTime;
      for (const cue of playable) {
        const source = context.createBufferSource();
        this.sources.add(source);
        source.buffer = buffers.get(cue.id)!;
        source.connect(this.gain!);
        source.onended = () => {
          if (!this.sources.delete(source)) return;
          source.onended = null;
          source.disconnect();
          if (!isCurrent()) return;
          this.publish(this.sources.size ? 'playing' : 'idle',
            `${this.sources.size ? '선택한 소리를 재생하고 있습니다.' : '재생을 마쳤습니다.'}${warning}`);
        };
        source.start(baseTime + cue.at);
      }
      this.publish('playing', `선택한 소리를 재생하고 있습니다.${warning}`);
    } catch {
      if (!isCurrent()) return;
      this.clearSources();
      this.publish('error', '오디오 준비 또는 재생에 실패했습니다. 지원 브라우저에서 다시 눌러 주세요.');
    }
  }

  dispose() {
    if (this.disposed) return;
    this.stop('청취 재생기를 종료했습니다.');
    this.disposed = true;
    this.decoded.clear();
    this.context?.removeEventListener('statechange', this.contextChanged);
    this.gain?.disconnect();
    if (this.context) {
      try { void this.context.close().catch(() => {}); } catch { /* Closing must not leave an unhandled failure. */ }
    }
  }
}
