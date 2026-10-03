import test from 'node:test';
import assert from 'node:assert/strict';
import { H1 } from '../src/characters/h1.ts';
import { createCombat, stepCombat, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createMatch, startMatch, stepMatch, pauseMatch, nextRound } from '../src/combat/match.ts';

const input = (changes = {}) => ({ ...N, ...changes });
const tick = (s, a = N, b = N) => stepCombat(s, [a, b]);
const chord = () => input({ attacks: ['lp', 'hp'], handEvents: [
  { slot: 'lp', down: true }, { slot: 'hp', down: true },
  { slot: 'hp', down: false }, { slot: 'lp', down: false },
] });
function placed(distance = 100) {
  const s = createCombat();
  Object.assign(s.fighters[0], { x: 500, facing: 1 });
  Object.assign(s.fighters[1], { x: 500 + distance, facing: -1 });
  return s;
}
// Public-state timing fixtures isolate the exact contact/recovery boundary.
function attack(s, side, key, age, serial = 1) {
  Object.assign(s.fighters[side], { action: 'attack', posture: key.startsWith('crouch') ? 'crouch' : 'stand',
    attack: { key, serial, age, hitTargets: [] }, nextAttackId: serial + 1 });
  return s;
}
const match = (combat, remainingFrames = 3600) => ({ ...startMatch(createMatch()), combat, remainingFrames });
const matchTick = (s, a = N, b = N) => stepMatch(s, [a, b]);

for (const [key, rules] of Object.entries(H1.attacks)) {
  test(`S events: ${key} emits one whiff at the first recovery frame, not either neighbor`, () => {
    const firstRecovery = rules.startup + rules.active;
    let s = attack(placed(400), 0, key, firstRecovery - 2, 7);
    assert.deepEqual(s.whiffEvents, []);
    s = tick(s); assert.equal(s.fighters[0].attack.age, firstRecovery - 1);
    assert.deepEqual(s.whiffEvents, []);
    const before = structuredClone(s), previousEvents = s.whiffEvents;
    s = tick(s);
    assert.equal(s.fighters[0].attack.age, firstRecovery);
    assert.deepEqual(s.whiffEvents, [{ attacker: 0, attackId: 7, key }]);
    assert.deepEqual(s.events, []); assert.deepEqual(s.grabEvents, []);
    assert.deepEqual(before.whiffEvents, []); assert.notEqual(s.whiffEvents, previousEvents);
    const whiffEvents = s.whiffEvents;
    s = tick(s); assert.equal(s.fighters[0].attack.age, firstRecovery + 1);
    assert.deepEqual(s.whiffEvents, []); assert.notEqual(s.whiffEvents, whiffEvents);
    while (s.fighters[0].attack) { s = tick(s); assert.deepEqual(s.whiffEvents, []); }
    assert.deepEqual(s.fighters.map(f => f.hp), [100, 100]);
  });

  test(`S events: ${key} preserves one hit or guard event and never follows it with a whiff`, () => {
    for (const blocked of [false, true]) {
      const guard = blocked ? input({ axis: 1, crouch: rules.height === 'low' }) : N;
      let s = attack(placed(), 0, key, rules.startup - 1, 4);
      s = tick(s, N, guard);
      assert.deepEqual(s.events, [{ attacker: 0, target: 1, attackId: 4, key, blocked, damage: blocked ? 0 : rules.damage }]);
      assert.deepEqual(s.whiffEvents, []);
      assert.deepEqual(s.fighters[0].attack.hitTargets, [1]);
      while (s.fighters[0].attack) {
        s = tick(s, N, guard);
        assert.deepEqual(s.events, []); assert.deepEqual(s.whiffEvents, []);
      }
    }
  });
}

test('S events: either owner can whiff with the same numeric attack ID in one tick', () => {
  const s = tick(attack(attack(placed(400), 0, 'stand-lp', 8), 1, 'crouch-hk', 17));
  assert.deepEqual(s.whiffEvents, [
    { attacker: 0, attackId: 1, key: 'stand-lp' },
    { attacker: 1, attackId: 1, key: 'crouch-hk' },
  ]);
});

test('S events: being hit before or on the first recovery frame cancels a would-be whiff', () => {
  for (const age of [7, 8]) for (const side of [0, 1]) {
    const original = attack(attack(placed(150), side, 'stand-lp', age), 1 - side, 'stand-lk', 7);
    const before = structuredClone(original), s = tick(original);
    assert.deepEqual(original, before);
    assert.equal(s.events.length, 1); assert.equal(s.events[0].target, side);
    assert.equal(s.fighters[side].attack, null); assert.equal(s.fighters[side].action, 'hit');
    assert.deepEqual(s.whiffEvents, []);
  }
});

test('S events: grab hold or immediate escape on first recovery cancels the old attack without a whiff', () => {
  for (const tech of [false, true]) for (const key of ['stand-lp', 'crouch-lp']) {
    let s = tick(placed(84), N, chord());
    for (let age = 1; age <= 5; age++) s = tick(s);
    attack(s, 0, key, 8);
    s = tick(s, tech ? chord() : N);
    assert.deepEqual(s.grabEvents.map(event => event.kind), [tech ? 'escape' : 'hold']);
    assert.equal(s.fighters[0].attack, null); assert.deepEqual(s.events, []);
    assert.deepEqual(s.whiffEvents, []);
  }
});

test('S events: a later hit never repeats an already emitted whiff', () => {
  let s = tick(attack(placed(400), 0, 'stand-lp', 8));
  assert.equal(s.whiffEvents.length, 1);
  s.fighters[1].x = 600;
  attack(s, 1, 'stand-lp', 5);
  s = tick(s);
  assert.equal(s.events.length, 1); assert.equal(s.fighters[0].attack, null);
  assert.deepEqual(s.whiffEvents, []);
});

test('S events: combo replacement never labels a new attack ID with the preceding attack recovery', () => {
  for (const distance of [100, 110, 140]) {
    let s = placed(distance);
    const hits = [], whiffs = [], starts = [];
    const commands = new Map([[0, ['lp']], [3, ['hp']], [14, ['lk']]]);
    for (let frame = 0; frame < 80; frame++) {
      s = tick(s, input({ attacks: commands.get(frame) ?? [] }));
      hits.push(...s.events); whiffs.push(...s.whiffEvents);
      if (s.fighters[0].attack?.age === 0) starts.push([s.fighters[0].attack.key, s.fighters[0].attack.serial]);
      if (frame === 9 && distance < 140) {
        assert.equal(s.fighters[0].attack.key, 'stand-hp'); assert.deepEqual(s.whiffEvents, []);
      }
      if (frame === 22 && distance < 140) {
        assert.equal(s.fighters[0].attack.key, 'stand-lk'); assert.deepEqual(s.whiffEvents, []);
      }
    }
    assert.equal(hits.length, distance === 100 ? 3 : distance === 110 ? 2 : 0);
    assert.deepEqual(whiffs, distance === 100 ? [] : [{ attacker: 0,
      attackId: distance === 110 ? 3 : 1, key: distance === 110 ? 'stand-lk' : 'stand-lp' }]);
    assert.equal(starts.length, distance < 140 ? 3 : 1);
  }
});

test('S events: a missed grab stays silent through preparation, active and recovery', () => {
  let s = tick(placed(400), chord());
  for (let age = 0; age <= 32; age++) {
    assert.deepEqual(s.events, []); assert.deepEqual(s.grabEvents, []); assert.deepEqual(s.whiffEvents, []);
    if (age < 32) s = tick(s);
  }
  assert.equal(s.fighters[0].action, 'free');
});

test('S events: pause retains the last whiff, while resume and a fresh round cannot emit it again', () => {
  let s = match(tick(attack(placed(400), 0, 'stand-lp', 8)));
  const last = s.combat.whiffEvents;
  s = pauseMatch(s, true);
  assert.equal(matchTick(s), s); assert.equal(s.combat.whiffEvents, last);
  s = matchTick(pauseMatch(s, false));
  assert.deepEqual(s.combat.whiffEvents, []);
  s.remainingFrames = 1; s = matchTick(s); s = nextRound(s);
  assert.equal(s.combat.frame, 0); assert.deepEqual(s.combat.whiffEvents, []);
});

test('S events: the final timeout tick preserves its new whiff and result ticks do not advance combat', () => {
  const initial = match(attack(placed(400), 0, 'stand-lp', 8), 1), before = structuredClone(initial);
  const s = matchTick(initial);
  assert.deepEqual(initial, before);
  assert.equal(s.remainingFrames, 0); assert.equal(s.phase, 'round-result');
  assert.deepEqual(s.combat.whiffEvents, [{ attacker: 0, attackId: 1, key: 'stand-lp' }]);
  assert.equal(s.combat.frame, 1); assert.equal(matchTick(s), s);
});

test('S events: final KO and simultaneous KO retain actual hits, without a cancelled-attack whiff', () => {
  for (const simultaneous of [false, true]) {
    const combat = attack(attack(placed(), 0, 'stand-lp', simultaneous ? 5 : 8), 1, 'stand-lp', 5);
    combat.fighters[0].hp = 8; combat.fighters[1].hp = 8;
    let s = matchTick(match(combat, 1));
    assert.equal(s.result.reason, simultaneous ? 'double-ko' : 'ko');
    assert.equal(s.combat.events.length, simultaneous ? 2 : 1);
    assert.deepEqual(s.combat.whiffEvents, []); assert.equal(s.remainingFrames, 0);
    const finalCombat = s.combat;
    for (let frame = 0; frame < 20; frame++) {
      s = matchTick(s); assert.equal(s.combat, finalCombat);
      assert.equal(tick(s.combat), finalCombat);
    }
  }
});
