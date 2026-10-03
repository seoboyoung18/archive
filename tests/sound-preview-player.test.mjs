import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewPlayer } from '../src/audio/preview-player.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const packet = id => new Uint8Array([id]).buffer;
const audio = new Map([['hit-lp', packet(1)], ['hit-hp', packet(2)], ['guard', packet(3)]]);
const cue = (id = 'hit-lp', at = 0) => ({ id, at });

class FakeSource {
  buffer = null;
  onended = null;
  starts = [];
  stops = 0;
  disconnects = 0;
  connect(node) { this.connected = node; }
  start(at) {
    if (this.failStart) throw Error('source start failed');
    this.starts.push(at);
  }
  stop() { this.stops++; }
  disconnect() { this.disconnects++; }
  end() { this.onended?.(); }
}

class FakeContext extends EventTarget {
  state = 'suspended';
  currentTime = 10;
  destination = {};
  resumeCalls = 0;
  closeCalls = 0;
  sources = [];
  decodeCalls = [];
  decodePlans = new Map();
  gain = {
    gain: { value: 1, setValueAtTime(value, time) { this.value = value; this.time = time; } },
    disconnects: 0,
    connect(destination) { this.destination = destination; },
    disconnect() { this.disconnects++; },
  };
  resume() {
    this.resumeCalls++;
    return (this.resumePlan?.promise ?? Promise.resolve()).then(() => {
      if (!this.staySuspended && this.state !== 'closed') this.state = 'running';
    });
  }
  createGain() { return this.gain; }
  createBufferSource() {
    const source = new FakeSource();
    source.failStart = this.failStartIndex === this.sources.length;
    this.sources.push(source);
    return source;
  }
  decodeAudioData(bytes) {
    const id = new Uint8Array(bytes)[0];
    this.decodeCalls.push({ id, bytes });
    const plan = this.decodePlans.get(id);
    return plan instanceof Error ? Promise.reject(plan) : plan?.promise ?? Promise.resolve({ id, duration: 0.1 });
  }
  changeState(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
  close() { this.closeCalls++; this.state = 'closed'; return Promise.resolve(); }
}

function setup() {
  const context = new FakeContext(), states = [];
  let created = 0;
  const player = new PreviewPlayer(() => { created++; return context; }, state => states.push(state));
  return { player, context, states, created: () => created };
}

test('Preview: the click calls resume synchronously, then all cues share the ready audio clock', async () => {
  const { player, context, created } = setup(), pending = deferred();
  context.resumePlan = pending;
  assert.equal(created(), 0);
  const playing = player.play([cue(), cue('hit-hp', 0.6)], audio);
  assert.equal(created(), 1); assert.equal(context.resumeCalls, 1);
  assert.equal(player.state.status, 'preparing'); assert.equal(context.decodeCalls.length, 0);
  assert.equal(context.gain.gain.value, 0.3);
  // A queued initial suspended notification is not a new interruption.
  context.changeState('suspended');
  context.currentTime = 25;
  pending.resolve(); await playing;
  assert.equal(player.state.status, 'playing'); assert.equal(player.state.active, 2);
  assert.deepEqual(context.sources.map(source => source.starts), [[25], [25.6]]);
  assert.notEqual(context.decodeCalls[0].bytes, audio.get('hit-lp'));
  assert.equal(audio.get('hit-lp').byteLength, 1);
});

test('Preview: stop while resume is pending discards the request before decoding', async () => {
  const { player, context } = setup(), pending = deferred();
  context.resumePlan = pending;
  const playing = player.play([cue()], audio);
  player.stop('사용자가 정지했습니다.');
  pending.resolve(); await playing;
  assert.equal(context.decodeCalls.length, 0); assert.equal(context.sources.length, 0);
  assert.equal(player.state.status, 'stopped'); assert.equal(player.state.message, '사용자가 정지했습니다.');
});

test('Preview: late decode success or rejection cannot play or overwrite a stopped selection', async () => {
  for (const fail of [false, true]) {
    const { player, context, states } = setup(), pending = deferred();
    context.decodePlans.set(1, pending);
    const playing = player.play([cue()], audio);
    await flush(); assert.equal(context.decodeCalls.length, 1);
    player.stop(); const count = states.length;
    if (fail) pending.reject(Error('decode failed')); else pending.resolve({ id: 1 });
    await playing;
    assert.equal(context.sources.length, 0); assert.equal(states.length, count);
    assert.equal(player.state.status, 'stopped');
  }
});

test('Preview: a new click replaces a pending resume without a late previous selection', async () => {
  const { player, context, states } = setup(), pending = deferred();
  context.resumePlan = pending;
  const old = player.play([cue()], audio);
  context.resumePlan = null;
  await player.play([cue('guard')], audio);
  const count = states.length;
  pending.resolve(); await old;
  assert.equal(states.length, count);
  assert.deepEqual(context.sources.map(source => source.buffer.id), [3]);
  assert.equal(player.state.active, 1);
});

test('Preview: a new click replaces a pending decode and ignores its late completion', async () => {
  const { player, context, states } = setup(), pending = deferred();
  context.decodePlans.set(1, pending);
  const old = player.play([cue()], audio);
  await flush();
  await player.play([cue('hit-hp')], audio);
  const count = states.length;
  pending.resolve({ id: 1 }); await old;
  assert.equal(states.length, count);
  assert.deepEqual(context.sources.map(source => source.buffer.id), [2]);
});

test('Preview: stop removes playing and future nodes plus their ended callbacks', async () => {
  const { player, context } = setup();
  await player.play([cue(), cue('guard', 5)], audio);
  const callbacks = context.sources.map(source => source.onended);
  player.stop();
  assert.equal(player.state.active, 0);
  for (const source of context.sources) {
    assert.equal(source.stops, 1); assert.equal(source.disconnects, 1); assert.equal(source.onended, null);
  }
  for (const callback of callbacks) callback();
  assert.equal(player.state.status, 'stopped'); assert.equal(player.state.active, 0);
});

test('Preview: replacing a playing combination cancels old nodes without cancelling new nodes', async () => {
  const { player, context } = setup();
  await player.play([cue(), cue('guard', 5)], audio);
  const oldNodes = [...context.sources], oldEnd = oldNodes[0].onended;
  await player.play([cue('hit-hp')], audio);
  for (const source of oldNodes) assert.equal(source.stops, 1);
  oldEnd();
  assert.equal(player.state.status, 'playing'); assert.equal(player.state.active, 1);
  assert.equal(context.sources.at(-1).stops, 0);
});

test('Preview: volume zero cancels resume, decode and already scheduled playback; raising it never replays', async () => {
  for (const phase of ['resume', 'decode', 'playing']) {
    const { player, context } = setup(), pending = deferred();
    if (phase === 'resume') context.resumePlan = pending;
    if (phase === 'decode') context.decodePlans.set(1, pending);
    const playing = player.play([cue()], audio);
    await flush();
    const count = context.sources.length;
    player.setVolume(0); player.setVolume(0.7);
    pending.resolve({ id: 1 }); await playing;
    assert.equal(context.sources.length, count); assert.equal(player.state.active, 0);
    assert.equal(player.state.status, 'stopped'); assert.equal(context.gain.gain.value, 0.7);
    assert.equal(player.state.message, '음량을 복원했습니다. 다시 눌러 재생해 주세요.');
    for (const source of context.sources) assert.equal(source.stops, 1);
  }
  const { player, created } = setup();
  player.setVolume(0); await player.play([cue()], audio);
  assert.equal(created(), 0); assert.equal(player.state.active, 0);
  assert.match(player.state.message, /음량이 0입니다/);
  player.setVolume(0.1); player.setVolume(0.2); player.setVolume(0.3);
  assert.equal(player.state.status, 'stopped'); assert.equal(player.state.active, 0);
  assert.equal(player.state.message, '음량을 복원했습니다. 다시 눌러 재생해 주세요.');
  assert.equal(created(), 0, 'restoring volume only changes guidance, without activating audio');
});

test('Preview: same-ID simultaneous sounds share decoding but use independent sources and finish idle', async () => {
  const { player, context } = setup();
  await player.play([cue('hit-hp'), cue('hit-hp')], audio);
  assert.equal(context.decodeCalls.length, 1);
  assert.equal(context.sources.length, 2); assert.equal(player.state.active, 2);
  assert.notEqual(context.sources[0], context.sources[1]);
  assert.equal(context.sources[0].buffer, context.sources[1].buffer);
  assert.deepEqual(context.sources.map(source => source.starts), [[10], [10]]);
  context.sources[0].end();
  assert.equal(player.state.active, 1); assert.equal(player.state.status, 'playing');
  context.sources[1].end();
  assert.equal(player.state.active, 0); assert.equal(player.state.status, 'idle');
  for (const source of context.sources) { assert.equal(source.disconnects, 1); assert.equal(source.onended, null); }
  await player.play([cue('hit-hp')], audio);
  assert.equal(context.decodeCalls.length, 1);
});

test('Preview: missing and decode-failed IDs are named while prepared cues play, and completion retains the warning', async () => {
  const { player, context } = setup();
  context.decodePlans.set(2, Error('invalid audio'));
  await player.play([cue('missing'), cue('hit-hp'), cue('guard', 0.2)], audio);
  assert.equal(player.state.status, 'playing'); assert.equal(player.state.active, 1);
  assert.match(player.state.message, /missing/); assert.match(player.state.message, /hit-hp/);
  assert.equal(context.sources[0].buffer.id, 3); assert.deepEqual(context.sources[0].starts, [10.2]);
  context.sources[0].end();
  assert.equal(player.state.status, 'idle'); assert.match(player.state.message, /hit-hp/);
  context.decodePlans.delete(2);
  await player.play([cue('hit-hp')], audio);
  assert.equal(player.state.status, 'playing');
  assert.equal(context.decodeCalls.filter(call => call.id === 2).length, 2, 'a failed decode can be retried');
});

test('Preview: all missing cues and activation failures resolve with an error, never an unhandled rejection', async () => {
  const unavailable = new PreviewPlayer(() => { throw Error('no Web Audio'); });
  await assert.doesNotReject(unavailable.play([cue()], audio));
  assert.equal(unavailable.state.status, 'error');
  for (const fail of ['reject', 'suspended', 'missing']) {
    const { player, context } = setup();
    if (fail === 'reject') { context.resumePlan = deferred(); context.resumePlan.reject(Error('denied')); }
    if (fail === 'suspended') context.staySuspended = true;
    await assert.doesNotReject(player.play([cue(fail === 'missing' ? 'missing' : 'hit-lp')], audio));
    assert.equal(player.state.status, 'error'); assert.equal(player.state.active, 0);
    assert.equal(context.sources.length, 0);
  }
});

test('Preview: an audio interruption cancels pending decode or playback and returning to running does not resume it', async () => {
  for (const phase of ['decode', 'playing']) {
    const { player, context } = setup(), pending = deferred();
    if (phase === 'decode') context.decodePlans.set(1, pending);
    const playing = player.play([cue(), cue('guard', 4)], audio);
    await flush();
    context.changeState('suspended');
    assert.equal(player.state.status, 'stopped'); assert.equal(player.state.active, 0);
    context.changeState('running'); pending.resolve({ id: 1 }); await playing;
    assert.equal(context.resumeCalls, 1); assert.equal(player.state.status, 'stopped');
    assert.equal(player.state.active, 0);
  }
});

test('Preview: dispose cancels every preparation phase, closes once and removes context listeners', async () => {
  for (const phase of ['resume', 'decode', 'playing']) {
    const { player, context, states } = setup(), pending = deferred();
    if (phase === 'resume') context.resumePlan = pending;
    if (phase === 'decode') context.decodePlans.set(1, pending);
    const playing = player.play([cue()], audio); await flush();
    player.dispose(); player.dispose();
    const count = states.length;
    context.changeState('running'); pending.resolve({ id: 1 }); await playing;
    await player.play([cue('guard')], audio);
    assert.equal(states.length, count); assert.equal(player.state.active, 0);
    assert.equal(context.closeCalls, 1); assert.equal(context.gain.disconnects, 1);
    for (const source of context.sources) { assert.equal(source.stops, 1); assert.equal(source.onended, null); }
  }
});

test('Preview: a source scheduling failure cleans up all nodes already created for that selection', async () => {
  const { player, context } = setup();
  context.failStartIndex = 1;
  await assert.doesNotReject(player.play([cue(), cue('hit-hp')], audio));
  assert.equal(player.state.status, 'error'); assert.equal(player.state.active, 0);
  for (const source of context.sources) {
    assert.equal(source.stops, 1); assert.equal(source.disconnects, 1); assert.equal(source.onended, null);
  }
});
