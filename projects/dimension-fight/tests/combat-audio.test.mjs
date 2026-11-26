import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatAudio } from '../src/audio/combat-audio.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const packet = id => new Uint8Array([id]).buffer;
const cue = (id = 'hit-lp', key = 'session:1:hit:1') => ({ id, key });

class FakeSource {
  buffer = null;
  onended = null;
  starts = [];
  stops = 0;
  disconnects = 0;
  connect(node) { this.connected = node; if (this.failConnect) throw Error('connect'); }
  start(at) { if (this.failStart) throw Error('start'); this.starts.push(at); }
  stop() { this.stops++; if (this.failStop) throw Error('stop'); }
  disconnect() { this.disconnects++; if (this.failDisconnect) throw Error('disconnect'); }
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
    connect(destination) { this.destination = destination; if (this.failConnect) throw Error('gain connect'); },
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
    if (this.failCreate) throw Error('create source');
    const source = new FakeSource();
    source.failStart = this.failStartIndex === this.sources.length;
    source.failConnect = this.failConnectIndex === this.sources.length;
    this.sources.push(source);
    return source;
  }
  decodeAudioData(bytes) {
    const id = new Uint8Array(bytes)[0];
    this.decodeCalls.push({ id, bytes });
    if (this.throwDecode) throw Error('decode sync');
    const plan = this.decodePlans.get(id);
    return plan instanceof Error ? Promise.reject(plan) : plan?.promise ?? Promise.resolve({ id, duration: 0.1 });
  }
  changeState(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
  close() { this.closeCalls++; this.state = 'closed'; return this.failClose ? Promise.reject(Error('close')) : Promise.resolve(); }
}

function setup() {
  const context = new FakeContext(), states = [];
  let created = 0;
  const audio = new CombatAudio(() => { created++; return context; }, state => states.push(state));
  return { audio, context, states, created: () => created };
}
const load = audio => { audio.load('hit-lp', packet(1)); audio.load('hit-hp', packet(2)); audio.load('guard', packet(3)); };
async function ready() {
  const fixture = setup(); load(fixture.audio); await fixture.audio.activate(); await flush(); return fixture;
}
const interruptions = [
  { name: 'pause', stop: audio => audio.setPaused(true), restore: audio => audio.setPaused(false) },
  { name: 'off', stop: audio => audio.setEnabled(false), restore: audio => audio.setEnabled(true) },
  { name: 'zero', stop: audio => audio.setVolume(0), restore: audio => audio.setVolume(0.3) },
  { name: 'session', stop: audio => audio.beginSession(), restore: () => {} },
];

test('S2 audio: initial settings and fetched packets do not create a context or auto-play; resume is synchronous in activate', async () => {
  const { audio, context, created } = setup(), pending = deferred();
  context.resumePlan = pending;
  const bytes = packet(1); audio.load('hit-lp', bytes);
  assert.equal(created(), 0); assert.equal(context.decodeCalls.length, 0);
  assert.deepEqual({ enabled: audio.state.enabled, volume: audio.state.volume, unlocked: audio.state.unlocked,
    active: audio.state.active, ready: audio.state.readyCount }, { enabled: true, volume: 0.3, unlocked: false, active: 0, ready: 0 });
  audio.consume([cue()]);
  assert.equal(created(), 0); assert.equal(audio.state.dropped, 1);
  const activating = audio.activate();
  assert.equal(created(), 1); assert.equal(context.resumeCalls, 1);
  assert.equal(context.gain.gain.value, 0.3); assert.equal(context.decodeCalls.length, 1);
  assert.notEqual(context.decodeCalls[0].bytes, bytes);
  context.changeState('suspended'); // Duplicate initial notification is not an interruption.
  await flush(); audio.consume([cue()]);
  assert.equal(audio.state.readyCount, 1); assert.equal(audio.state.dropped, 2);
  assert.equal(context.sources.length, 0);
  pending.resolve(); await activating;
  assert.equal(audio.state.unlocked, true); assert.equal(context.sources.length, 0, 'missed events are never replayed');
  audio.consume([cue()]); assert.equal(audio.state.played, 1); assert.deepEqual(context.sources[0].starts, [10]);
});

test('S2 audio: pending decode and later file arrival drop past events and serve only the next event', async () => {
  const { audio, context } = setup(), pending = deferred();
  context.decodePlans.set(1, pending); audio.load('hit-lp', packet(1));
  await audio.activate();
  audio.consume([cue(), cue('guard')]);
  assert.equal(audio.state.dropped, 2); assert.equal(audio.state.readyCount, 0);
  pending.resolve({ id: 1 }); audio.load('guard', packet(3)); await flush();
  assert.equal(audio.state.readyCount, 2); assert.equal(context.sources.length, 0);
  audio.consume([cue('guard')]);
  assert.equal(audio.state.played, 1); assert.equal(audio.state.dropped, 2); assert.equal(context.sources[0].buffer.id, 3);
});

test('S2 audio: one to five same-render event batches keep separate sources and never cut existing tails', async () => {
  const { audio, context } = await ready();
  let expected = 0;
  for (let size = 1; size <= 5; size++) {
    context.currentTime += 1 / 60;
    audio.consume(Array.from({ length: size }, (_, index) => cue('hit-hp', `${size}:${index}`)));
    expected += size;
    assert.equal(audio.state.active, expected); assert.equal(audio.state.played, expected);
    for (const source of context.sources) assert.equal(source.stops, 0);
    for (const source of context.sources.slice(-size)) assert.deepEqual(source.starts, [context.currentTime]);
  }
  assert.equal(new Set(context.sources).size, 15);
  assert.equal(context.decodeCalls.filter(call => call.id === 2).length, 1);
  audio.consume([]); // The result screen makes no new calls; it does not end the last sound.
  assert.equal(audio.state.active, 15);
  for (const source of context.sources) source.end();
  assert.equal(audio.state.active, 0); assert.equal(audio.state.played, 15); assert.equal(audio.state.lastSound, 'hit-hp');
  for (const source of context.sources) { assert.equal(source.disconnects, 1); assert.equal(source.stops, 0); assert.equal(source.onended, null); }
});

test('S2 audio: pause/off/zero/session invalidates late resume even if the flags are restored first', async () => {
  for (const interruption of interruptions) {
    const { audio, context } = setup(), pending = deferred();
    load(audio); context.resumePlan = pending;
    const activating = audio.activate();
    interruption.stop(audio); interruption.restore(audio);
    pending.resolve(); await activating; await flush();
    assert.equal(audio.state.unlocked, false, interruption.name);
    audio.consume([cue()]);
    assert.equal(context.sources.length, 0); assert.equal(audio.state.dropped, 1);
    context.resumePlan = null;
    await audio.activate(); audio.consume([cue()]);
    assert.equal(audio.state.played, 1); assert.equal(context.sources.length, 1);
  }
});

test('S2 audio: late decode can fill a shared asset cache after pause without replaying or unlocking', async () => {
  for (const interruption of interruptions) {
    const { audio, context } = setup(), pending = deferred();
    context.decodePlans.set(1, pending); audio.load('hit-lp', packet(1));
    await audio.activate(); audio.consume([cue()]);
    interruption.stop(audio); interruption.restore(audio);
    pending.resolve({ id: 1 }); await flush();
    assert.equal(audio.state.readyCount, 1); assert.equal(audio.state.unlocked, false);
    assert.equal(context.sources.length, 0);
    await audio.activate(); audio.consume([cue()]); assert.equal(context.sources.length, 1);
  }
});

test('S2 audio: explicit activation while paused prepares sound but only new events after resume can play', async () => {
  const { audio, context } = setup(); load(audio); audio.setPaused(true);
  await audio.activate();
  assert.equal(context.resumeCalls, 1); assert.equal(audio.state.unlocked, true); assert.equal(audio.state.paused, true);
  audio.consume([cue()]); assert.equal(audio.state.dropped, 1); assert.equal(context.sources.length, 0);
  audio.setPaused(false); assert.equal(context.resumeCalls, 1);
  audio.consume([cue('guard')]); assert.equal(context.sources.length, 1); assert.equal(context.sources[0].buffer.id, 3);
  audio.setPaused(true);
  const pending = deferred(); context.resumePlan = pending;
  const activating = audio.activate();
  audio.setPaused(true); // A new blur/pause invalidates even when already paused.
  pending.resolve(); await activating;
  assert.equal(audio.state.unlocked, false); assert.equal(audio.state.active, 0);
});

test('S2 audio: explicit stops disconnect all sources and stale ended callbacks cannot remove newer ones', async () => {
  for (const interruption of interruptions) {
    const { audio, context } = await ready();
    audio.consume([cue(), cue('hit-hp')]);
    const old = [...context.sources], callbacks = old.map(source => source.onended);
    interruption.stop(audio);
    assert.equal(audio.state.active, 0); assert.equal(audio.state.unlocked, false);
    for (const source of old) { assert.equal(source.stops, 1); assert.equal(source.disconnects, 1); assert.equal(source.onended, null); }
    interruption.restore(audio); await audio.activate(); audio.consume([cue('guard')]);
    for (const callback of callbacks) callback();
    assert.equal(audio.state.active, 1); assert.equal(context.sources.at(-1).stops, 0);
  }
});

test('S2 audio: session reset preserves page settings and decoded files but resets counters and unlock', async () => {
  const { audio, context } = await ready();
  audio.setVolume(0.74); audio.consume([cue(), cue('missing')]);
  assert.equal(audio.state.played, 1); assert.equal(audio.state.dropped, 1);
  audio.setEnabled(false); audio.beginSession();
  assert.deepEqual({ enabled: audio.state.enabled, volume: audio.state.volume, ready: audio.state.readyCount,
    played: audio.state.played, dropped: audio.state.dropped, last: audio.state.lastSound },
  { enabled: false, volume: 0.74, ready: 3, played: 0, dropped: 0, last: null });
  await audio.activate(); assert.equal(context.resumeCalls, 1, 'disabled activation does nothing');
  audio.setEnabled(true); assert.equal(audio.state.unlocked, false);
  await audio.activate(); audio.consume([cue('guard')]);
  assert.equal(context.decodeCalls.length, 3); assert.equal(context.gain.gain.value, 0.74);
});

test('S2 audio: actual suspended/closed states clear sources and a spontaneous running transition never unlocks', async () => {
  for (const state of ['suspended', 'closed', 'interrupted']) {
    const { audio, context } = await ready();
    audio.consume([cue()]); context.changeState(state);
    assert.equal(audio.state.unlocked, false); assert.equal(audio.state.active, 0);
    context.changeState('running'); audio.consume([cue()]);
    assert.equal(context.sources.length, 1); assert.equal(audio.state.dropped, 1); assert.equal(context.resumeCalls, 1);
    await audio.activate(); audio.consume([cue()]); assert.equal(context.sources.length, 2);
  }
});

test('S2 audio: a new interruption during an activation request invalidates its later running resolution', async () => {
  const { audio, context } = await ready(), pending = deferred();
  context.resumePlan = pending;
  const activating = audio.activate();
  context.changeState('suspended');
  pending.resolve(); await activating;
  assert.equal(context.state, 'running'); assert.equal(audio.state.unlocked, false);
  audio.consume([cue()]); assert.equal(audio.state.dropped, 1); assert.equal(context.sources.length, 0);
});

test('S2 audio: latest activation owns the result and older rejection cannot overwrite it', async () => {
  const { audio, context, states } = setup(), pending = deferred(); load(audio);
  context.resumePlan = pending; const old = audio.activate();
  context.resumePlan = null; await audio.activate();
  const count = states.length;
  pending.reject(Error('old denial')); await old;
  assert.equal(audio.state.unlocked, true); assert.equal(states.length, count);
  audio.consume([cue()]); assert.equal(audio.state.played, 1);
});

test('S2 audio: unsupported, rejected and non-running activation resolve safely without a playback backlog', async () => {
  const unavailable = new CombatAudio(() => { throw Error('no Web Audio'); });
  unavailable.load('hit-lp', packet(1));
  await assert.doesNotReject(unavailable.activate()); unavailable.consume([cue()]);
  assert.equal(unavailable.state.contextState, 'unavailable'); assert.equal(unavailable.state.dropped, 1);
  for (const mode of ['reject', 'suspended']) {
    const { audio, context } = setup(); load(audio);
    if (mode === 'reject') { context.resumePlan = deferred(); context.resumePlan.reject(Error('denied')); }
    else context.staySuspended = true;
    await assert.doesNotReject(audio.activate()); audio.consume([cue()]);
    assert.equal(audio.state.unlocked, false); assert.equal(audio.state.dropped, 1); assert.equal(context.sources.length, 0);
  }
});

test('S2 audio: fetch/decode failures affect only that ID and a replacement ignores stale success or failure', async () => {
  for (const oldFails of [false, true]) {
    const { audio, context } = setup(), old = deferred();
    context.decodePlans.set(1, old); context.decodePlans.set(2, Error('bad hp'));
    load(audio); audio.fail('whiff'); await audio.activate(); await flush();
    assert.deepEqual(audio.state.failedIds, ['hit-hp', 'whiff']);
    audio.consume([cue(), cue('hit-hp'), cue('guard')]);
    assert.equal(audio.state.played, 1); assert.equal(audio.state.dropped, 2);
    audio.load('hit-lp', packet(4)); await flush();
    if (oldFails) old.reject(Error('old decode')); else old.resolve({ id: 1 });
    await flush(); audio.consume([cue()]);
    assert.equal(context.sources.at(-1).buffer.id, 4);
    context.decodePlans.delete(2); audio.load('hit-hp', packet(2)); await flush();
    assert.deepEqual(audio.state.failedIds, ['whiff']); assert.equal(audio.state.readyCount, 3);
  }
});

test('S2 audio: fail revokes a pending file and synchronous decoding errors do not abort other files', async () => {
  const { audio, context } = setup(), pending = deferred();
  context.decodePlans.set(1, pending); audio.load('hit-lp', packet(1)); await audio.activate();
  audio.fail('hit-lp'); pending.resolve({ id: 1 }); await flush();
  assert.equal(audio.state.readyCount, 0); assert.deepEqual(audio.state.failedIds, ['hit-lp']);
  context.throwDecode = true; assert.doesNotThrow(() => audio.load('hit-hp', packet(2)));
  context.throwDecode = false; audio.load('guard', packet(3)); await flush();
  assert.deepEqual(audio.state.failedIds, ['hit-hp', 'hit-lp']);
  audio.consume([cue('guard')]); assert.equal(audio.state.played, 1);
});

test('S2 audio: source creation/connect/start failures drop only that event and clean partial nodes', async () => {
  for (const mode of ['create', 'connect', 'start']) {
    const { audio, context } = await ready(); audio.consume([cue()]);
    if (mode === 'create') context.failCreate = true;
    if (mode === 'connect') context.failConnectIndex = 1;
    if (mode === 'start') context.failStartIndex = 1;
    assert.doesNotThrow(() => audio.consume([cue('guard')]));
    assert.equal(audio.state.played, 1); assert.equal(audio.state.dropped, 1); assert.equal(audio.state.active, 1);
    assert.equal(context.sources[0].stops, 0, 'an unrelated existing tail survives');
    if (mode !== 'create') { assert.equal(context.sources[1].disconnects, 1); assert.equal(context.sources[1].onended, null); }
    context.failCreate = false; audio.consume([cue('guard')]); assert.equal(audio.state.played, 2);
  }
});

test('S2 audio: partial gain setup is released before a fresh explicit activation retry', async () => {
  const broken = new FakeContext(), fresh = new FakeContext(); broken.gain.failConnect = true;
  let created = 0;
  const audio = new CombatAudio(() => created++ === 0 ? broken : fresh);
  load(audio); await audio.activate();
  assert.equal(broken.closeCalls, 1); assert.equal(broken.gain.disconnects, 1); assert.equal(audio.state.unlocked, false);
  await audio.activate(); await flush(); audio.consume([cue()]);
  assert.equal(created, 2); assert.equal(audio.state.played, 1);
});

test('S2 audio: volume is finite/clamped, no setting change creates a context, and zero restoration cannot resume', async () => {
  const { audio, context, created } = setup();
  audio.setVolume(NaN); assert.equal(audio.state.volume, 0.3);
  audio.setVolume(10); assert.equal(audio.state.volume, 1);
  audio.setVolume(-3); assert.equal(audio.state.volume, 0); await audio.activate(); assert.equal(created(), 0);
  audio.setVolume(0.6); audio.setEnabled(false); audio.setEnabled(true); audio.setPaused(false);
  assert.equal(created(), 0);
  load(audio); await audio.activate(); audio.consume([cue()]);
  audio.setVolume(0); audio.setVolume(0.6); audio.consume([cue()]);
  assert.equal(audio.state.unlocked, false); assert.equal(audio.state.dropped, 1); assert.equal(context.resumeCalls, 1);
  assert.equal(context.gain.gain.value, 0.6);
});

test('S2 audio: disposal cancels pending activation/decode and live sources, closes once, and detaches notifications', async () => {
  for (const phase of ['resume', 'decode', 'playing']) {
    const { audio, context, states } = setup(), pending = deferred();
    if (phase === 'resume') context.resumePlan = pending;
    if (phase === 'decode') context.decodePlans.set(1, pending);
    load(audio); const activating = audio.activate(); await flush();
    if (phase === 'playing') audio.consume([cue()]);
    audio.dispose(); audio.dispose(); const count = states.length;
    context.changeState('running'); pending.resolve({ id: 1 }); await activating; await flush();
    audio.load('guard', packet(3)); audio.fail('missing'); audio.consume([cue()]); await audio.activate();
    assert.equal(states.length, count); assert.equal(audio.state.active, 0); assert.equal(audio.state.readyCount, 0);
    assert.equal(audio.state.unlocked, false); assert.equal(context.closeCalls, 1); assert.equal(context.gain.disconnects, 1);
    for (const source of context.sources) { assert.equal(source.stops, 1); assert.equal(source.disconnects, 1); assert.equal(source.onended, null); }
  }
});

test('S2 audio: cleanup and diagnostic failures cannot stop combat calls or leak the remaining sources', async () => {
  const context = new FakeContext(); context.failClose = true;
  const audio = new CombatAudio(() => context, () => { throw Error('diagnostic view'); });
  load(audio); await audio.activate(); audio.consume([cue(), cue('guard')]);
  context.sources[0].failStop = true; context.sources[0].failDisconnect = true;
  assert.doesNotThrow(() => audio.setPaused(true));
  assert.equal(audio.state.active, 0); assert.equal(context.sources[1].disconnects, 1);
  assert.doesNotThrow(() => audio.dispose()); await flush();
});
