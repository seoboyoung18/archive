import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatSoundCursor } from '../src/audio/combat-sound-cues.ts';
import { H1 } from '../src/characters/h1.ts';
import { createCombat, stepCombat, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createMatch, startMatch, stepMatch, pauseMatch, nextRound } from '../src/combat/match.ts';
import { FixedStep } from '../src/combat/fixed-step.ts';

const input = (attacks = [], changes = {}) => ({ ...N, ...changes, attacks });
const chord = () => input(['lp', 'hp'], { handEvents: [
  { slot: 'lp', down: true }, { slot: 'hp', down: true },
  { slot: 'hp', down: false }, { slot: 'lp', down: false },
] });
const ids = cues => cues.map(cue => cue.id);
function close(distance = 100) {
  const s = createCombat();
  s.fighters[0].x = 500; s.fighters[1].x = 500 + distance;
  return s;
}
function replay(initial, commands, frames, cursor = new CombatSoundCursor()) {
  let state = initial;
  const heard = [], states = [];
  for (let frame = 0; frame < frames; frame++) {
    state = stepCombat(state, commands(frame, state));
    heard.push(...cursor.consume(state).map(cue => ({ ...cue, frame: state.frame })));
    states.push(state);
  }
  return { state, heard, states, cursor };
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test('Sound cursor starts empty and resets its frame and identity only for an explicit new session', () => {
  const cursor = new CombatSoundCursor();
  assert.equal(cursor.session, 0);
  assert.equal(cursor.retainedCount, 0);
  assert.deepEqual(cursor.consume(createCombat()), []);
  const result = replay(close(), f => [f === 0 ? input(['lp']) : N, N], 7, cursor);
  assert.deepEqual(ids(result.heard), ['hit-lp']);
  const oldKey = result.heard[0].key;
  assert.deepEqual(cursor.consume(result.state), []);
  assert.deepEqual(cursor.consume(createCombat()), []);
  cursor.beginSession();
  assert.equal(cursor.session, 1);
  assert.equal(cursor.retainedCount, 0);
  assert.deepEqual(cursor.consume(createCombat()), []);
  const again = replay(close(), f => [f === 0 ? input(['lp']) : N, N], 7, cursor);
  assert.deepEqual(ids(again.heard), ['hit-lp']);
  assert.notEqual(again.heard[0].key, oldKey);
});

test('Eight grounded attacks on either side share four hit slots and use only guard on a blocked contact', () => {
  for (const [key, attack] of Object.entries(H1.attacks)) for (const side of [0, 1]) for (const blocked of [false, true]) {
    const target = 1 - side, s = close(), slot = key.split('-')[1];
    s.fighters[target].x = side === 0 ? 1200 : 80;
    s.fighters[side].x = s.fighters[target].x + (side === 0 ? -100 : 100);
    const defender = blocked ? input([], { axis: side === 0 ? 1 : -1, crouch: attack.height === 'low' }) : N;
    const result = replay(s, frame => {
      const pair = [N, N];
      pair[side] = input(frame === 0 ? [slot] : [], { crouch: key.startsWith('crouch-') });
      pair[target] = defender;
      return pair;
    }, attack.startup + attack.active + attack.recovery + 2);
    assert.deepEqual(ids(result.heard), [blocked ? 'guard' : `hit-${slot}`], `${key}, side ${side}, guard ${blocked}`);
    assert.equal(result.state.fighters[target].hp, blocked ? 100 : 100 - attack.damage);
  }
});

test('Eight real missed attacks emit one whiff at the first recovery tick', () => {
  for (const [key, attack] of Object.entries(H1.attacks)) {
    const result = replay(createCombat(), frame => [
      input(frame === 0 ? [key.split('-')[1]] : [], { crouch: key.startsWith('crouch-') }), N,
    ], attack.startup + attack.active + attack.recovery + 2);
    assert.deepEqual(ids(result.heard), ['whiff'], key);
    assert.equal(result.heard[0].frame, attack.startup + attack.active + 1, key);
  }
});

test('Simultaneous equal attack IDs remain separate, duplicate events collapse, and consuming cannot mutate combat', () => {
  const result = replay(close(), frame => [frame === 0 ? input(['lp']) : N, frame === 0 ? input(['lp']) : N], 7);
  assert.equal(result.state.events.length, 2);
  assert.deepEqual(result.state.events.map(e => e.attackId), [1, 1]);
  const duplicate = structuredClone(result.state);
  duplicate.events.push(...structuredClone(duplicate.events));
  const before = structuredClone(duplicate), cursor = new CombatSoundCursor();
  const cues = cursor.consume(deepFreeze(duplicate));
  assert.deepEqual(ids(cues), ['hit-lp', 'hit-lp']);
  assert.equal(new Set(cues.map(c => c.key)).size, 2);
  assert.deepEqual(duplicate, before);
  assert.deepEqual(cursor.consume(duplicate), []);
});

test('An active attack retains its consumed identity across later ticks and older snapshots never replay', () => {
  const cursor = new CombatSoundCursor();
  const { state: hit } = replay(close(), frame => [frame === 0 ? input(['lp']) : N, N], 7, cursor);
  const next = stepCombat(hit, [N, N]);
  // Exercise the consumer's duplicate protection independently of core event clearing.
  assert.deepEqual(cursor.consume({ ...next, events: hit.events }), []);
  assert.equal(cursor.retainedCount, 1);
  let state = next;
  for (let n = 0; n < 30; n++) { state = stepCombat(state, [N, N]); cursor.consume(state); }
  assert.equal(cursor.retainedCount, 0);
  assert.deepEqual(cursor.consume(hit), []);
});

test('The actual C chain yields three different cues at contact frames 6, 19 and 30', () => {
  const commands = new Map([[0, ['lp']], [3, ['hp']], [14, ['lk']]]);
  const result = replay(close(), frame => [input(commands.get(frame) ?? []), N], 60);
  assert.deepEqual(ids(result.heard), ['hit-lp', 'hit-hp', 'hit-lk']);
  assert.deepEqual(result.heard.map(c => c.frame - 1), [6, 19, 30]);
  assert.equal(new Set(result.heard.map(c => c.key)).size, 3);
});

test('A successful throw emits one hold and one H36 impact for either owner and target posture', () => {
  for (const side of [0, 1]) for (const crouch of [false, true]) {
    const result = replay(close(84), frame => {
      const pair = [N, N]; pair[side] = frame === 0 ? chord() : N; pair[1 - side] = input([], { crouch });
      return pair;
    }, 82);
    assert.deepEqual(ids(result.heard), ['grab-hold', 'grab-impact']);
    assert.deepEqual(result.heard.map(c => c.frame), [7, 43]);
    assert.equal(result.state.fighters[1 - side].hp, 82);
    assert.equal(result.cursor.retainedCount, 0);
  }
});

test('H0 and H12 escape, simultaneous grabs and failed grabs use only their actual pair events', () => {
  for (const techAge of [0, 12]) {
    const result = replay(close(84), frame => [frame === 0 ? chord() : N, frame === 6 + techAge ? chord() : N], 85);
    assert.deepEqual(ids(result.heard), techAge === 0 ? ['grab-escape'] : ['grab-hold', 'grab-escape']);
    assert.equal(result.heard.at(-1).frame, 7 + techAge);
    assert.deepEqual(result.state.fighters.map(f => f.hp), [100, 100]);
  }
  const both = replay(close(84), frame => [frame === 0 ? chord() : N, frame === 0 ? chord() : N], 45);
  assert.deepEqual(ids(both.heard), ['grab-escape']);
  const missed = replay(createCombat(), frame => [frame === 0 ? chord() : N, N], 45);
  assert.deepEqual(missed.heard, []);
});

test('Same grab serial owned by the other fighter later in one session is not lost', () => {
  const cursor = new CombatSoundCursor();
  let result = replay(close(84), frame => [frame === 0 ? chord() : N, N], 80, cursor);
  const heard = [...result.heard];
  result = replay(result.state, () => [N, input([], { axis: -1 })], 10, cursor);
  result = replay(result.state, frame => [N, frame === 0 ? chord() : N], 80, cursor);
  heard.push(...result.heard);
  assert.deepEqual(ids(heard), ['grab-hold', 'grab-impact', 'grab-hold', 'grab-impact']);
  assert.equal(new Set(heard.map(c => c.key)).size, 4);
});

test('Throw history persists while the target is locked after the owner recovers, then clears', () => {
  const cursor = new CombatSoundCursor();
  let s = close(84);
  for (let frame = 0; frame <= 79; frame++) {
    s = stepCombat(s, [frame === 0 ? chord() : N, N]); cursor.consume(s);
    if (frame >= 60 && frame <= 77) assert.equal(cursor.retainedCount, 2);
  }
  assert.equal(cursor.retainedCount, 0);
});

test('Last-tick KO and double KO cues are consumed once after result entry', () => {
  for (const simultaneous of [false, true]) {
    const cursor = new CombatSoundCursor();
    let match = { ...startMatch(createMatch()), combat: close(), remainingFrames: 7 };
    match.combat.fighters[1].hp = 8;
    if (simultaneous) match.combat.fighters[0].hp = 8;
    const heard = [];
    for (let frame = 0; frame < 30; frame++) {
      match = stepMatch(match, [frame === 0 ? input(['lp']) : N, simultaneous && frame === 0 ? input(['lp']) : N]);
      heard.push(...cursor.consume(match.combat));
    }
    assert.equal(match.result.reason, simultaneous ? 'double-ko' : 'ko');
    assert.deepEqual(ids(heard), simultaneous ? ['hit-lp', 'hit-lp'] : ['hit-lp']);
    assert.equal(new Set(heard.map(c => c.key)).size, heard.length);
  }
  const cursor = new CombatSoundCursor(), heard = [];
  let match = { ...startMatch(createMatch()), combat: close(84), remainingFrames: 43 };
  match.combat.fighters[1].hp = 18;
  for (let frame = 0; frame < 65; frame++) {
    match = stepMatch(match, [frame === 0 ? chord() : N, N]);
    heard.push(...cursor.consume(match.combat));
  }
  assert.equal(match.result.reason, 'ko');
  assert.equal(match.combat.grabPair, null, 'the ending throw is executable no longer');
  assert.deepEqual(ids(heard), ['grab-hold', 'grab-impact'], 'the final impact survives pair cleanup');
});

test('A timeout consumes final hit, whiff, hold, impact and escape events without advancing a cancelled throw', () => {
  const cases = [
    { frames: 7, state: close(), commands: f => [f === 0 ? input(['lp']) : N, N], expected: ['hit-lp'] },
    { frames: 10, state: createCombat(), commands: f => [f === 0 ? input(['lp']) : N, N], expected: ['whiff'] },
    { frames: 7, state: close(84), commands: f => [f === 0 ? chord() : N, N], expected: ['grab-hold'] },
    { frames: 43, state: close(84), commands: f => [f === 0 ? chord() : N, N], expected: ['grab-hold', 'grab-impact'] },
    { frames: 42, state: close(84), commands: f => [f === 0 ? chord() : N, N], expected: ['grab-hold'] },
    { frames: 7, state: close(84), commands: f => [f === 0 ? chord() : N, f === 6 ? chord() : N], expected: ['grab-escape'] },
    { frames: 19, state: close(84), commands: f => [f === 0 ? chord() : N, f === 18 ? chord() : N], expected: ['grab-hold', 'grab-escape'] },
  ];
  for (const scenario of cases) {
    let match = { ...startMatch(createMatch()), combat: scenario.state, remainingFrames: scenario.frames };
    const cursor = new CombatSoundCursor(), heard = [];
    for (let frame = 0; frame < scenario.frames + 50; frame++) {
      match = stepMatch(match, scenario.commands(frame)); heard.push(...cursor.consume(match.combat));
    }
    assert.ok(match.result.reason.startsWith('timeout'));
    assert.deepEqual(ids(heard), scenario.expected);
    assert.equal(match.combat.frame, scenario.frames);
  }
});

test('Paused match snapshots are silent and same-number tie replays receive a new sound session', () => {
  let match = { ...startMatch(createMatch()), combat: close(), remainingFrames: 8 };
  const cursor = new CombatSoundCursor(), heard = [];
  for (let frame = 0; frame < 7; frame++) {
    match = stepMatch(match, [frame === 0 ? input(['lp']) : N, frame === 0 ? input(['lp']) : N]);
    heard.push(...cursor.consume(match.combat));
  }
  match = pauseMatch(match, true);
  for (let n = 0; n < 100; n++) {
    match = stepMatch(match, [chord(), chord()]); assert.deepEqual(cursor.consume(match.combat), []);
  }
  match = stepMatch(pauseMatch(match, false), [N, N]);
  assert.deepEqual(cursor.consume(match.combat), []);
  assert.equal(match.result.reason, 'timeout-tie');
  const oldRound = match.round;
  match = nextRound(match); cursor.beginSession();
  assert.equal(match.round, oldRound);
  assert.deepEqual(cursor.consume(match.combat), []);
  match.combat.fighters[0].x = 500; match.combat.fighters[1].x = 600;
  for (let frame = 0; frame < 7; frame++) {
    match = stepMatch(match, [frame === 0 ? input(['lp']) : N, frame === 0 ? input(['lp']) : N]);
    heard.push(...cursor.consume(match.combat));
  }
  assert.deepEqual(ids(heard), ['hit-lp', 'hit-lp', 'hit-lp', 'hit-lp']);
  assert.equal(new Set(heard.map(c => c.key)).size, 4);
});

test('Consuming after every FixedStep tick preserves all C contacts with one through five ticks per render', () => {
  const commands = new Map([[0, ['lp']], [3, ['hp']], [14, ['lk']]]);
  for (let perRender = 1; perRender <= 5; perRender++) {
    const fixed = new FixedStep(), cursor = new CombatSoundCursor(), heard = [];
    let s = close(), frame = 0;
    while (frame < 60) fixed.advance(perRender * 1000 / 60, () => {
      s = stepCombat(s, [input(commands.get(frame++) ?? []), N]); heard.push(...cursor.consume(s));
    });
    assert.deepEqual(ids(heard), ['hit-lp', 'hit-hp', 'hit-lk'], `${perRender} ticks/render`);
    assert.deepEqual(cursor.consume(s), []);
  }
});

test('A long real combat discards old IDs instead of accumulating consumption history', () => {
  const cursor = new CombatSoundCursor(), keys = new Set(), slots = ['lp', 'hp', 'lk', 'hk'];
  let s = createCombat(), maximum = 0;
  for (let frame = 0; frame < 20000; frame++) {
    const commands = s.fighters.map(f => f.action === 'free' ? input([slots[(f.nextAttackId - 1) % slots.length]]) : N);
    s = stepCombat(s, commands);
    for (const cue of cursor.consume(s)) {
      assert.equal(cue.id, 'whiff'); assert.ok(!keys.has(cue.key)); keys.add(cue.key);
    }
    maximum = Math.max(maximum, cursor.retainedCount);
    assert.ok(cursor.retainedCount <= 4, 'at most the two current attacks and two recent contacts');
  }
  assert.ok(keys.size > 1000);
  assert.ok(maximum > 0);
  for (let frame = 0; frame < 80; frame++) { s = stepCombat(s, [N, N]); cursor.consume(s); }
  assert.equal(cursor.retainedCount, 0);
  cursor.beginSession(); assert.equal(cursor.retainedCount, 0);
});
