import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatAudio } from '../src/audio/combat-audio.ts';
import { CombatSoundCursor } from '../src/audio/combat-sound-cues.ts';
import { createCombat, stepCombat, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createMatch, startMatch, stepMatch, pauseMatch, nextRound } from '../src/combat/match.ts';

// Only the browser device is substituted: combat, match, cursor and audio are real modules.
class Device extends EventTarget {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  sources = [];
  createGain() { return { gain: { setValueAtTime() {} }, connect() {}, disconnect() {} }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  decodeAudioData(bytes) { return Promise.resolve({ id: new TextDecoder().decode(bytes), duration: 0.12 }); }
  createBufferSource() {
    const source = { buffer: null, onended: null, startedAt: null, stops: 0, disconnected: false, ended: false,
      connect() {}, start(at) { this.startedAt = at; }, stop() { this.stops++; },
      disconnect() { this.disconnected = true; } };
    this.sources.push(source);
    return source;
  }
  advance() {
    this.currentTime += 1 / 60;
    for (const source of this.sources) {
      if (!source.ended && !source.disconnected && source.startedAt !== null
        && this.currentTime >= source.startedAt + source.buffer.duration) {
        source.ended = true; source.onended?.();
      }
    }
  }
}

const slotIds = ['hit-lp', 'hit-hp', 'hit-lk', 'hit-hk', 'guard', 'whiff', 'grab-hold', 'grab-impact', 'grab-escape'];
const input = (attacks = [], changes = {}) => ({ ...N, ...changes, attacks });
const chord = () => input(['lp', 'hp'], { handEvents: [
  { slot: 'lp', down: true }, { slot: 'hp', down: true }, { slot: 'hp', down: false }, { slot: 'lp', down: false },
] });
const packet = id => new TextEncoder().encode(id).buffer;
const flush = () => new Promise(resolve => setImmediate(resolve));
function close(distance = 100) {
  const s = createCombat(); s.fighters[0].x = 500; s.fighters[1].x = 500 + distance; return s;
}
async function sound(ids = slotIds) {
  const device = new Device(), audio = new CombatAudio(() => device), cursor = new CombatSoundCursor();
  for (const id of ids) audio.load(id, packet(id));
  await audio.activate(); await flush();
  return { device, audio, cursor };
}
function consume(fixture, state) {
  const before = structuredClone(state);
  const cues = fixture.cursor.consume(state);
  fixture.audio.consume(cues);
  assert.deepEqual(state, before, 'neither consumer nor runtime can alter the completed tick');
  return cues;
}

test('S2 integration: real C hits discarded while muted or missing never return when audio becomes available', async () => {
  const f = await sound(slotIds.filter(id => id !== 'hit-hp'));
  f.audio.setEnabled(false);
  let state = close(), silentReference = close();
  const commands = new Map([[0, ['lp']], [3, ['hp']], [14, ['lk']]]);
  const seen = [];
  for (let frame = 0; frame < 60; frame++) {
    if (frame === 7) { f.audio.setEnabled(true); await f.audio.activate(); }
    if (frame === 20) {
      f.audio.load('hit-hp', packet('hit-hp')); await flush();
      consume(f, state); // Loading completion cannot replay the previous frame's dropped HP.
    }
    const pair = [input(commands.get(frame) ?? []), N];
    state = stepCombat(state, pair); silentReference = stepCombat(silentReference, pair);
    f.device.advance(); seen.push(...consume(f, state));
    assert.deepEqual(state, silentReference);
  }
  assert.deepEqual(seen.map(c => c.id), ['hit-lp', 'hit-hp', 'hit-lk']);
  assert.equal(state.fighters[1].hp, 70);
  assert.equal(f.audio.state.dropped, 2);
  assert.equal(f.audio.state.played, 1);
  assert.deepEqual(f.device.sources.map(source => source.buffer.id), ['hit-lk']);
  assert.equal(f.audio.state.active, 0);
  f.audio.dispose();
});

test('S2 integration: actual KO impact and timeout whiff finish normally, but an explicit pause cuts their tail', async () => {
  for (const ending of ['throw-ko', 'whiff-timeout']) {
    const f = await sound(), combat = ending === 'throw-ko' ? close(84) : createCombat();
    if (ending === 'throw-ko') combat.fighters[1].hp = 18;
    let match = { ...startMatch(createMatch()), combat, remainingFrames: ending === 'throw-ko' ? 43 : 10 };
    let reference = structuredClone(match);
    let frame = 0;
    while (match.phase === 'playing') {
      const pair = [frame++ === 0 ? ending === 'throw-ko' ? chord() : input(['lp']) : N, N];
      match = stepMatch(match, pair); reference = stepMatch(reference, pair);
      f.device.advance(); consume(f, match.combat); assert.deepEqual(match, reference);
    }
    assert.equal(match.result.reason, ending === 'throw-ko' ? 'ko' : 'timeout-tie');
    const expected = ending === 'throw-ko' ? ['grab-hold', 'grab-impact'] : ['whiff'];
    assert.deepEqual(f.device.sources.map(source => source.buffer.id), expected);
    const final = f.device.sources.at(-1), played = f.audio.state.played;
    assert.equal(f.audio.state.active, 1, 'result entry does not silence the final event');
    for (let n = 0; n < 2; n++) {
      match = stepMatch(match, [N, N]); f.device.advance(); consume(f, match.combat);
    }
    assert.equal(f.audio.state.played, played);
    assert.equal(final.stops, 0);
    assert.equal(f.audio.state.active, 1);
    f.audio.setPaused(true);
    assert.equal(f.audio.state.active, 0);
    assert.equal(final.stops, 1);
    assert.equal(final.disconnected, true);
    f.audio.dispose();
  }
});

test('S2 integration: pause after hold drops its tail and freezes H, then resumes only the future H36 impact', async () => {
  const f = await sound();
  let match = { ...startMatch(createMatch()), combat: close(84) };
  for (let frame = 0; frame < 7; frame++) {
    match = stepMatch(match, [frame === 0 ? chord() : N, N]); f.device.advance(); consume(f, match.combat);
  }
  assert.equal(match.combat.grabPair.age, 0);
  assert.equal(f.audio.state.active, 1);
  const hold = f.device.sources[0];
  match = pauseMatch(match, true); f.audio.setPaused(true);
  const paused = structuredClone(match);
  for (let frame = 0; frame < 40; frame++) {
    match = stepMatch(match, [chord(), chord()]); f.device.advance(); consume(f, match.combat);
  }
  assert.deepEqual(match, paused);
  assert.equal(hold.stops, 1);
  assert.equal(f.audio.state.played, 1);
  assert.equal(f.audio.state.dropped, 0);
  match = pauseMatch(match, false); f.audio.setPaused(false); await f.audio.activate();
  consume(f, match.combat);
  assert.equal(f.device.sources.length, 1, 'resume never replays the H0 hold');
  for (let frame = 0; frame < 36; frame++) {
    match = stepMatch(match, [N, N]); f.device.advance(); consume(f, match.combat);
  }
  assert.equal(match.combat.fighters[1].hp, 82);
  assert.deepEqual(f.device.sources.map(source => source.buffer.id), ['grab-hold', 'grab-impact']);
  assert.equal(f.audio.state.active, 1);
  f.audio.dispose();
});

test('S2 integration: same-number rematch clears old tails and allows identical attack IDs in the new session', async () => {
  const f = await sound(), keys = [];
  f.audio.setVolume(0.6);
  let match = { ...startMatch(createMatch()), combat: close(), remainingFrames: 7 };
  for (let frame = 0; frame < 7; frame++) {
    match = stepMatch(match, [frame === 0 ? input(['lp']) : N, frame === 0 ? input(['lp']) : N]);
    f.device.advance(); keys.push(...consume(f, match.combat).map(c => c.key));
  }
  assert.equal(match.result.reason, 'timeout-tie');
  assert.equal(f.audio.state.active, 2);
  const old = [...f.device.sources], round = match.round;
  match = nextRound(match); f.cursor.beginSession(); f.audio.beginSession();
  assert.equal(match.round, round);
  assert.equal(f.audio.state.active, 0);
  assert.equal(f.audio.state.played, 0);
  assert.equal(f.audio.state.volume, 0.6);
  assert.equal(f.audio.state.readyCount, 9);
  assert.ok(old.every(source => source.stops === 1 && source.disconnected));
  assert.deepEqual(consume(f, match.combat), []);
  await f.audio.activate();
  // Approach through ordinary movement from the round's freshly reset 400/880 roots.
  while (match.combat.fighters[1].x - match.combat.fighters[0].x > 104) {
    match = stepMatch(match, [input([], { axis: 1 }), input([], { axis: -1 })]);
    f.device.advance(); consume(f, match.combat);
  }
  for (let frame = 0; frame < 7; frame++) {
    match = stepMatch(match, [frame === 0 ? input(['lp']) : N, frame === 0 ? input(['lp']) : N]);
    f.device.advance(); keys.push(...consume(f, match.combat).map(c => c.key));
  }
  assert.deepEqual(match.combat.events.map(event => event.attackId), [1, 1]);
  assert.equal(new Set(keys).size, 4);
  assert.equal(f.audio.state.played, 2);
  assert.equal(f.audio.state.active, 2);
  assert.deepEqual(f.device.sources.slice(2).map(source => source.buffer.id), ['hit-lp', 'hit-lp']);
  f.audio.dispose();
});
