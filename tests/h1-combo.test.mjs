import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombat, stepCombat, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createMatch, startMatch, stepMatch, pauseMatch, nextRound, restartMatch } from '../src/combat/match.ts';
import { CombatInputBuffer } from '../src/input/combat-input.ts';

const input = (attacks = [], changes = {}) => ({ ...N, ...changes, attacks });
const tick = (s, a = N, b = N) => stepCombat(s, [a, b]);
function close({ distance = 100, reversed = false, corner = false, attacker = 0 } = {}) {
  const s = createCombat(), defender = 1 - attacker;
  const targetX = corner ? (reversed ? 80 : 1200) : (reversed ? 500 : 500 + distance);
  Object.assign(s.fighters[attacker], { x: targetX + (reversed ? distance : -distance), facing: reversed ? -1 : 1 });
  Object.assign(s.fighters[defender], { x: targetX, facing: reversed ? 1 : -1 });
  return s;
}
// Schedule only fresh public input pulses. Frame 0 is the first attack's age 0.
function replay(commands, options = {}) {
  const { attacker = 0, frames = 80, defenderInput = () => N, attackerInput = () => N } = options;
  let s = options.initial ?? close(options);
  const states = [], hits = [], starts = [];
  for (let frame = 0; frame <= frames; frame++) {
    const pair = [N, N];
    pair[attacker] = { ...attackerInput(frame, s), attacks: commands.get(frame) ?? [] };
    pair[1 - attacker] = defenderInput(frame, s);
    s = stepCombat(s, pair);
    const attack = s.fighters[attacker].attack;
    if (attack?.age === 0) starts.push({ frame, key: attack.key, serial: attack.serial });
    hits.push(...s.events.map(event => ({ frame, ...event })));
    states.push(s);
  }
  return { state: s, states, hits, starts };
}
const chain = (uAge = 3, iAge = 5) => new Map([[0, ['lp']], [uAge, ['hp']], [Math.max(9, uAge) + iAge, ['lk']]]);
const hitKeys = r => r.hits.map(h => h.key);

test('C01/C04: U→I gives 20 damage; U→I→J gives 30 through distinct one-hit attacks', () => {
  for (const attacker of [0, 1]) {
    const two = replay(new Map([[0, ['lp']], [3, ['hp']]]), { attacker });
    assert.deepEqual(hitKeys(two), ['stand-lp', 'stand-hp']);
    assert.equal(two.state.fighters[1 - attacker].hp, 80);
    const three = replay(chain(), { attacker });
    assert.deepEqual(three.starts, [
      { frame: 0, key: 'stand-lp', serial: 1 },
      { frame: 9, key: 'stand-hp', serial: 2 },
      { frame: 22, key: 'stand-lk', serial: 3 },
    ]);
    assert.deepEqual(hitKeys(three), ['stand-lp', 'stand-hp', 'stand-lk']);
    assert.deepEqual(three.hits.map(h => [h.attackId, h.damage, h.blocked]), [[1, 8, false], [2, 12, false], [3, 10, false]]);
    assert.equal(three.state.fighters[1 - attacker].hp, 70);
    assert.equal(three.state.fighters[attacker].action, 'free');
  }
});

test('C02: every allowed U input age 3…12 starts I at age 9 or the current recovery age', () => {
  for (let age = 3; age <= 12; age++) {
    const r = replay(new Map([[0, ['lp']], [age, ['hp']]]));
    assert.deepEqual(r.starts.map(a => [a.frame, a.key]), [[0, 'stand-lp'], [Math.max(9, age), 'stand-hp']], `U age ${age}`);
    assert.equal(r.states[Math.max(9, age)].fighters[0].attack.age, 0);
    assert.equal(r.state.fighters[1].hp, 80);
  }
  for (const age of [2, 13]) {
    const r = replay(new Map([[0, ['lp']], [age, ['hp']]]));
    assert.deepEqual(hitKeys(r), ['stand-lp'], `U age ${age} must be discarded`);
    assert.equal(r.starts.length, 1);
  }
});

test('C02: every allowed linked I input age 5…22 starts J at age 13 or current recovery age', () => {
  for (let age = 5; age <= 22; age++) {
    const r = replay(chain(3, age));
    assert.deepEqual(r.starts.map(a => [a.frame, a.key]), [[0, 'stand-lp'], [9, 'stand-hp'], [9 + Math.max(13, age), 'stand-lk']], `I age ${age}`);
    assert.equal(r.states[9 + Math.max(13, age)].fighters[0].attack.age, 0);
    assert.equal(r.state.fighters[1].hp, 70);
  }
  for (const age of [4, 23]) {
    const r = replay(chain(3, age));
    assert.deepEqual(hitKeys(r), ['stand-lp', 'stand-hp'], `I age ${age} must be discarded`);
    assert.equal(r.starts.length, 2);
  }
});

test('C02/C03: latest cancels keep the defender in hitstun through both follow-up contacts', () => {
  const r = replay(chain(12, 22), {
    defenderInput: frame => frame > 6 ? input(['hk'], { axis: 1, jump: true }) : N,
    frames: 42,
  });
  assert.deepEqual(r.hits.map(h => [h.frame, h.key, h.blocked]), [[6, 'stand-lp', false], [22, 'stand-hp', false], [42, 'stand-lk', false]]);
  for (let frame = 6; frame <= 42; frame++) {
    assert.equal(r.states[frame].fighters[1].action, 'hit', `defender escaped on frame ${frame}`);
    assert.equal(r.states[frame].fighters[1].grounded, true);
    assert.equal(r.states[frame].fighters[1].attack, null);
  }
  assert.equal(r.state.fighters[1].hp, 70);
});

test('C02: a last-active-frame U hit keeps the same cancel deadline', () => {
  for (const [age, expected] of [[12, ['stand-lp', 'stand-hp']], [13, ['stand-lp']]]) {
    const r = replay(new Map([[0, ['lp']], [age, ['hp']]]), {
      distance: 148, corner: true,
      defenderInput: frame => frame >= 6 && frame <= 8 ? input([], { axis: -1 }) : N,
    });
    assert.equal(r.hits[0].frame, 8);
    assert.deepEqual(hitKeys(r), expected);
  }
});

test('C01: standalone I, crouching U, K and airborne input cannot enter the fixed chain', () => {
  for (const commands of [new Map([[0, ['hp']], [5, ['lk']]]), new Map([[0, ['lp']], [3, ['hk']]]), new Map([[0, ['lp', 'hp']], [5, ['lk']]])]) {
    const r = replay(commands);
    assert.equal(r.starts.length, 1);
    assert.equal(r.starts[0].frame, 0, 'C approval does not add the unapproved hand-input delay');
  }
  const crouch = replay(chain(), { attackerInput: () => input([], { crouch: true }) });
  assert.deepEqual(hitKeys(crouch), ['crouch-lp']);
  assert.equal(crouch.starts.length, 1);
  const airborne = close();
  Object.assign(airborne.fighters[0], { grounded: false, y: 500, vy: -200 });
  const air = replay(chain(), { initial: airborne });
  assert.equal(air.starts.length, 0);
});

test('C01/C02: wrong and simultaneous keys are discarded without clearing an earlier valid reservation', () => {
  for (const wrong of [['lk'], ['hk'], ['hp', 'lp'], ['hp', 'lk']]) {
    const r = replay(new Map([[0, ['lp']], [3, wrong]]));
    assert.deepEqual(hitKeys(r), ['stand-lp']);
  }
  const commands = chain();
  commands.set(4, ['hk']); commands.set(5, ['hp', 'lk']); commands.set(6, ['hp']);
  commands.set(15, ['lp']); commands.set(16, ['lk', 'hk']); commands.set(17, ['lk']);
  const r = replay(commands);
  assert.deepEqual(r.starts.map(a => a.frame), [0, 9, 22]);
  assert.deepEqual(hitKeys(r), ['stand-lp', 'stand-hp', 'stand-lk']);
});

test('C01: direction, crouch and jump inputs do not change linked standing attacks or their facing', () => {
  for (const reversed of [false, true]) {
    const r = replay(chain(), {
      reversed, frames: 52,
      attackerInput: frame => frame > 0 ? input([], { axis: reversed ? 1 : -1, crouch: true, jump: true }) : N,
    });
    const initialX = r.states[0].fighters[0].x;
    for (const s of r.states.slice(0, 52)) {
      assert.equal(s.fighters[0].posture, 'stand');
      assert.equal(s.fighters[0].facing, reversed ? -1 : 1);
      assert.equal(s.fighters[0].grounded, true);
      assert.equal(s.fighters[0].x, initialX);
    }
    assert.equal(r.states[52].fighters[0].attack, null);
    assert.equal(r.states[52].fighters[0].posture, 'crouch');
  }
});

test('C03: exact central reach boundaries retain real pushback and positive rectangle overlap', () => {
  for (const attacker of [0, 1]) for (const reversed of [false, true]) {
    for (const [distance, damage, count] of [[72, 30, 3], [109, 30, 3], [110, 20, 2], [135, 20, 2], [136, 8, 1], [139, 8, 1], [140, 0, 0]]) {
      const r = replay(chain(), { distance, reversed, attacker });
      assert.equal(r.state.fighters[1 - attacker].hp, 100 - damage, `d=${distance}, reversed=${reversed}, attacker=${attacker}`);
      assert.equal(r.hits.length, count);
      const push = count === 3 ? 92 : count === 2 ? 60 : count === 1 ? 24 : 0;
      assert.equal(Math.abs(r.state.fighters[0].x - r.state.fighters[1].x), distance + push);
      assert.equal(r.state.fighters[attacker].x, r.states[0].fighters[attacker].x);
    }
  }
});

test('C03: either corner clamps pushback and permits three hits at d139, but d140 still misses U', () => {
  for (const reversed of [false, true]) for (const attacker of [0, 1]) for (const distance of [72, 139, 140]) {
    const r = replay(chain(), { distance, reversed, attacker, corner: true });
    assert.equal(r.state.fighters[1 - attacker].hp, distance < 140 ? 70 : 100);
    assert.equal(r.state.fighters[1 - attacker].x, reversed ? 80 : 1200);
    assert.equal(Math.abs(r.state.fighters[0].x - r.state.fighters[1].x), distance);
  }
});

test('C04: a blocked or whiffed U discards early reservations instead of starting I', () => {
  const blocked = replay(chain(), { defenderInput: () => input([], { axis: 1, crouch: true }) });
  assert.deepEqual(blocked.hits.map(h => [h.key, h.blocked, h.damage]), [['stand-lp', true, 0]]);
  assert.equal(blocked.starts.length, 1); assert.equal(blocked.state.fighters[1].hp, 100);
  const missed = replay(chain(), { distance: 140 });
  assert.equal(missed.hits.length, 0); assert.equal(missed.starts.length, 1);
});

test('C04: simultaneous hits and earlier incoming hits cancel queued follow-ups', () => {
  const simultaneous = replay(new Map([[0, ['lp']], [3, ['hp']]]), {
    defenderInput: frame => input(frame === 0 ? ['lp'] : frame === 3 ? ['hp'] : []),
  });
  assert.deepEqual(simultaneous.hits.map(h => [h.frame, h.attacker, h.key]), [[6, 0, 'stand-lp'], [6, 1, 'stand-lp']]);
  assert.deepEqual(simultaneous.state.fighters.map(f => f.hp), [92, 92]);
  assert.ok(simultaneous.states[6].fighters.every(f => f.attack === null));
  const interrupted = replay(new Map([[2, ['lp']], [5, ['hp']]]), {
    defenderInput: frame => input(frame === 0 ? ['lp'] : []),
  });
  assert.deepEqual(interrupted.hits.map(h => [h.attacker, h.key]), [[1, 'stand-lp']]);
  assert.equal(interrupted.state.fighters[0].nextAttackId, 2);
});

test('C04: J cannot cancel back to U and dropped commands do not replay after normal recovery', () => {
  const commands = chain();
  commands.set(27, ['lp']); commands.set(35, ['lp']); commands.set(51, ['lp']);
  const r = replay(commands);
  assert.equal(r.starts.length, 3); assert.equal(r.state.fighters[0].nextAttackId, 4);
  assert.equal(r.states[51].fighters[0].attack.key, 'stand-lk');
  assert.equal(r.states[52].fighters[0].attack, null);
  const fresh = tick(r.states[52], input(['lp']));
  assert.equal(fresh.fighters[0].attack.key, 'stand-lp');
  assert.equal(fresh.fighters[0].attack.serial, 4);
});

test('C01/C05: held keys and OS repeat create neither a delayed follow-up nor an automatic new chain', () => {
  for (const validFollowup of [false, true]) {
    let s = close(); const buffer = new CombatInputBuffer(), starts = [];
    for (let frame = 0; frame < 100; frame++) {
      if (frame === 0) buffer.keyDown('KeyU');
      if (frame === (validFollowup ? 3 : 2)) buffer.keyDown('KeyI');
      if (frame === 14) buffer.keyDown('KeyJ');
      buffer.keyDown('KeyU', true); buffer.keyDown('KeyI', true); buffer.keyDown('KeyJ', true);
      s = tick(s, buffer.sample());
      if (s.fighters[0].attack?.age === 0) starts.push(s.fighters[0].attack.key);
    }
    assert.deepEqual(starts, validFollowup ? ['stand-lp', 'stand-hp', 'stand-lk'] : ['stand-lp']);
    buffer.keyUp('KeyU'); buffer.keyDown('KeyU');
    s = tick(s, buffer.sample()); assert.equal(s.fighters[0].attack.key, 'stand-lp');
  }
});

function queuedMatch(link = 'U') {
  let s = startMatch(createMatch()); s.combat = close();
  const commands = chain();
  const end = link === 'U' ? 6 : 19;
  for (let frame = 0; frame <= end; frame++) s = stepMatch(s, [input(commands.get(frame) ?? []), N]);
  return s;
}

test('C05: pause removes reservations, freezes time and preserves hit-confirmed eligibility for new input', () => {
  for (const link of ['U', 'I']) {
    const original = queuedMatch(link), before = structuredClone(original);
    let paused = pauseMatch(original, true);
    assert.deepEqual(original, before, 'pausing cannot mutate a previous combat snapshot');
    assert.deepEqual(paused.combat.fighters.map(f => f.attack), original.combat.fighters.map(f => f.attack));
    const frozen = structuredClone(paused);
    for (let frame = 0; frame < 30; frame++) paused = stepMatch(paused, [input(['hp', 'lk']), N]);
    assert.deepEqual(paused, frozen);
    let noNewInput = pauseMatch(paused, false);
    for (let frame = 0; frame < 4; frame++) noNewInput = stepMatch(noNewInput, [N, N]);
    assert.equal(noNewInput.combat.fighters[0].attack.key, link === 'U' ? 'stand-lp' : 'stand-hp');
    const fresh = stepMatch(noNewInput, [input([link === 'U' ? 'hp' : 'lk']), N]);
    assert.equal(fresh.combat.fighters[0].attack.key, link === 'U' ? 'stand-hp' : 'stand-lk');
    assert.equal(fresh.combat.fighters[0].attack.age, 0);
  }
});

test('C04/C05: KO clears both combo states and prevents queued attacks or damage after the result', () => {
  const initial = close(); initial.fighters[1].hp = 8;
  // Stop replay at the KO tick because a frozen state's existing event is not a new event.
  const r = replay(chain(), { initial, frames: 6 });
  assert.equal(r.state.ended, true); assert.equal(r.state.fighters[1].hp, 0);
  assert.ok(r.state.fighters.every(f => f.combo === null));
  const frozen = structuredClone(r.state);
  for (let frame = 0; frame < 60; frame++) assert.deepEqual(tick(r.state, input(['hp', 'lk'])), frozen);
});

test('C05: timeout, tie replay, next round and full restart discard live combo state and reservations', () => {
  for (const resultType of ['round', 'tie', 'match']) {
    let s = queuedMatch();
    if (resultType === 'tie') s.combat.fighters[0].hp = s.combat.fighters[1].hp;
    if (resultType === 'match') s.wins = [1, 0];
    s.remainingFrames = 1;
    s = stepMatch(s, [N, N]);
    assert.ok(s.combat.fighters.every(f => f.combo === null), `${resultType} end retained combo state`);
    assert.equal(s.result.reason, resultType === 'tie' ? 'timeout-tie' : 'timeout');
    const frozen = structuredClone(s);
    assert.deepEqual(stepMatch(s, [input(['hp', 'lk']), N]), frozen);
    s = resultType === 'match' ? restartMatch(s) : nextRound(s);
    assert.deepEqual(s.combat, createCombat());
    s = startMatch(s);
    for (let frame = 0; frame < 30; frame++) s = stepMatch(s, [N, N]);
    assert.ok(s.combat.fighters.every(f => f.attack === null && f.hp === 100));
  }
});

test('C05: ticking an armed reservation leaves all previous combat state unchanged', () => {
  const armed = replay(new Map([[0, ['lp']], [3, ['hp']]]), { frames: 8 }).state;
  const before = structuredClone(armed), next = tick(armed);
  assert.deepEqual(armed, before);
  assert.equal(next.fighters[0].attack.key, 'stand-hp');
  assert.equal(next.fighters[0].attack.age, 0);
});
