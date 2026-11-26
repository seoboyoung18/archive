import test from 'node:test';
import assert from 'node:assert/strict';
import { H1 } from '../src/characters/h1.ts';
import { createCombat, stepCombat, clearComboInputs, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createMatch, startMatch, stepMatch, pauseMatch, nextRound, restartMatch, resultReady } from '../src/combat/match.ts';

const input = (changes = {}) => ({ ...N, ...changes });
const hand = (slot, down) => ({ slot, down });
const chord = (changes = {}) => input({ attacks: ['lp', 'hp'], handEvents: [
  hand('lp', true), hand('hp', true), hand('hp', false), hand('lp', false),
], ...changes });
const oneHand = (slot, down = true) => input({ attacks: down ? [slot] : [], handEvents: [hand(slot, down)] });
const kick = () => input({ attacks: ['hk'] });
const tick = (s, a = N, b = N) => stepCombat(s, [a, b]);
const tickSide = (s, side, own = N, other = N) => side === 0 ? tick(s, own, other) : tick(s, other, own);
function advance(s, frames, a = N, b = N) {
  for (let i = 0; i < frames; i++) s = tick(s, a, b);
  return s;
}
function close(distance = 84, reversed = false) {
  const s = createCombat();
  Object.assign(s.fighters[0], { x: reversed ? 500 + distance : 500, facing: reversed ? -1 : 1 });
  Object.assign(s.fighters[1], { x: reversed ? 500 : 500 + distance, facing: reversed ? 1 : -1 });
  return s;
}
function begin(s = close(), side = 0, other = N) {
  const next = tickSide(s, side, chord(), other);
  assert.equal(next.fighters[side].grab?.kind, 'attempt');
  assert.equal(next.fighters[side].grab.age, 0);
  return next;
}
function hold(s = close(), side = 0, other = N) {
  s = begin(s, side, other);
  for (let age = 1; age <= 6; age++) s = tickSide(s, side, N, other);
  assert.equal(s.grabPair?.attacker, side);
  assert.equal(s.grabPair.age, 0);
  return s;
}
function noExecutableGrab(s) {
  assert.equal(s.grabPair, null);
  for (const f of s.fighters) {
    assert.equal(f.grab, null);
    assert.equal(f.hands.pending, null);
    assert.deepEqual(f.hands.held, { lp: false, hp: false });
    assert.deepEqual(f.hands.downAt, { lp: null, hp: null });
    assert.equal(f.combo, null);
  }
}
function matchWith(combat, remainingFrames = 3600) {
  return { ...startMatch(createMatch()), combat, remainingFrames };
}
const matchTick = (s, a = N, b = N) => stepMatch(s, [a, b]);

test('G01: 72/96 contact succeeds, 97 misses, with symmetric roles and facing', () => {
  for (const reversed of [false, true]) for (const side of [0, 1]) for (const d of [72, 96, 97]) {
    const original = close(d, reversed), positions = original.fighters.map(f => f.x);
    let s = begin(original, side);
    s = advance(s, 5);
    assert.equal(s.grabPair, null, 'age 5 is preparation');
    assert.deepEqual(s.fighters.map(f => f.hp), [100, 100]);
    s = tick(s);
    assert.equal(s.grabPair?.attacker ?? null, d <= 96 ? side : null);
    assert.deepEqual(s.fighters.map(f => f.x), positions, 'holding must not snap the roots');
    assert.deepEqual(s.grabEvents.map(e => e.kind), d <= 96 ? ['hold'] : []);
  }
});

test('G02: age 7 still catches a newly approaching opponent; age 8 never does', () => {
  for (const approachAge of [7, 8]) {
    let s = begin(close(100));
    for (let age = 1; age <= approachAge; age++) {
      s = tick(s, N, age === approachAge ? input({ axis: -1 }) : N);
    }
    assert.equal(s.fighters[1].x - s.fighters[0].x, 96);
    assert.equal(s.grabPair?.attacker ?? null, approachAge === 7 ? 0 : null);
    if (approachAge === 8) assert.equal(s.fighters[0].grab.age, 8);
  }
});

test('G03: whiff is locked through age 31, then new input acts at age 32', () => {
  let s = begin(close(200));
  for (let age = 1; age <= 31; age++) {
    s = tick(s, input({ axis: 1, crouch: true, jump: true, attacks: ['hk'] }));
    assert.equal(s.fighters[0].grab?.age, age);
    assert.equal(s.fighters[0].action, 'grab');
    assert.equal(s.fighters[0].x, 500);
    assert.equal(s.fighters[0].grounded, true);
    assert.equal(s.fighters[0].posture, 'stand');
    assert.equal(s.fighters[0].attack, null);
  }
  s = tick(s, kick());
  assert.equal(s.fighters[0].grab, null);
  assert.equal(s.fighters[0].attack?.key, 'stand-hk');
  assert.equal(s.fighters[0].attack.age, 0);
});

test('G04: standing/crouching ground targets cannot guard a grab', () => {
  for (const side of [0, 1]) for (const crouch of [false, true]) {
    const s0 = close(72), target = 1 - side;
    const away = s0.fighters[target].x > s0.fighters[side].x ? 1 : -1;
    // Crouching is stationary; a standing target may retreat 28px before age 6,
    // so put that fixture against its arena edge to isolate guard eligibility.
    if (!crouch) {
      s0.fighters[target].x = away > 0 ? 1200 : 80;
      s0.fighters[side].x = s0.fighters[target].x - away * 72;
    }
    const s = hold(s0, side, input({ axis: away, crouch }));
    assert.equal(s.fighters[target].posture, crouch ? 'crouch' : 'stand');
    assert.equal(s.fighters[target].hp, 100);
    assert.equal(s.grabEvents[0].damage, 0);
  }
});

test('G05: a target jumping on the active tick is ineligible; landing can be caught', () => {
  let airborne = advance(begin(close()), 5);
  airborne = tick(airborne, N, input({ jump: true }));
  assert.equal(airborne.fighters[1].grounded, false);
  assert.equal(airborne.grabPair, null);
  assert.equal(tick(airborne).grabPair, null);

  const landingFixture = advance(begin(close()), 5);
  Object.assign(landingFixture.fighters[1], { grounded: false, y: 599, vy: 100, state: 'jump' });
  const landed = tick(landingFixture);
  assert.equal(landed.fighters[1].grounded, true);
  assert.equal(landed.grabPair?.attacker, 0);
});

test('G06: stun 1 to 0 remains excluded; only the following free tick is eligible', () => {
  for (const action of ['hit', 'guard']) for (const stun of [6, 7]) {
    let s = begin(close());
    Object.assign(s.fighters[1], { action, stun });
    s = advance(s, 6);
    assert.equal(s.grabPair, null);
    assert.equal(s.fighters[1].stun, stun - 6);
    s = tick(s);
    assert.equal(s.grabPair?.attacker ?? null, stun === 6 ? 0 : null);
    if (stun === 7) assert.equal(tick(s).grabPair, null, 'freedom at age 8 is too late');
  }
});

test('G07: target basic startup/recovery can be caught and its old attack never resumes', () => {
  let s = tick(close(), chord(), input({ attacks: ['hp'] }));
  assert.equal(s.fighters[1].attack?.key, 'stand-hp');
  s = advance(s, 6);
  assert.equal(s.grabPair?.attacker, 0);
  assert.equal(s.fighters[1].attack, null);
  s = advance(s, 80);
  assert.equal(s.fighters[1].attack, null);
  assert.equal(s.fighters[0].hp, 100);

  // Duck the high heavy kick until its active period ends, then catch its
  // ordinary recovery using a fresh grab command rather than injected locks.
  s = tick(close(), input({ crouch: true }), kick());
  s = advance(s, 16, input({ crouch: true }));
  assert.equal(s.fighters[0].hp, 100);
  assert.equal(s.fighters[1].attack?.age, 16);
  s = hold(s);
  assert.equal(s.fighters[1].attack, null);
  s = advance(s, 80);
  assert.equal(s.fighters[1].attack, null);
  assert.equal(s.fighters[0].hp, 100);
});

test('G08: simultaneous ordinary contact takes priority over either side grab attempt', () => {
  for (const side of [0, 1]) {
    let s = tickSide(close(), side, chord(), input({ attacks: ['lp'] }));
    s = advance(s, 6);
    assert.equal(s.grabPair, null);
    assert.equal(s.grabEvents.length, 0);
    assert.equal(s.fighters[side].hp, 92);
    assert.equal(s.fighters[side].action, 'hit');
    assert.equal(s.fighters[side].grab, null);
  }
});

test('G09: simultaneous grabs escape once, dealing zero damage with no array-order winner', () => {
  for (const reversed of [false, true]) {
    const initial = close(84, reversed), before = initial.fighters.map(f => f.x);
    let s = tick(initial, chord(), chord());
    s = advance(s, 6);
    assert.equal(s.grabPair, null);
    assert.deepEqual(s.fighters.map(f => f.hp), [100, 100]);
    assert.equal(s.grabEvents.filter(e => e.kind === 'escape').length, 1);
    assert.deepEqual(s.fighters.map(f => f.grab?.kind), ['escape', 'escape']);
    assert.deepEqual(s.fighters.map(f => f.x), [before[0] + (reversed ? 16 : -16), before[1] + (reversed ? -16 : 16)]);
    s = advance(s, 11);
    assert.ok(s.fighters.every(f => f.action === 'grab'));
    s = tick(s);
    assert.ok(s.fighters.every(f => f.action === 'free' && f.grab === null));
  }
});

test('G10: a one-tick earlier grab catches the later attempt independent of fighter index', () => {
  for (const side of [0, 1]) {
    let s = begin(close(), side);
    s = tickSide(s, side, N, chord());
    s = advance(s, 5);
    assert.equal(s.grabPair?.attacker, side);
    assert.equal(s.grabEvents[0].kind, 'hold');
  }
});

test('G11: impact occurs exactly H+36 once, with fixed-direction 48 push and no early damage', () => {
  for (const reversed of [false, true]) for (const side of [0, 1]) {
    let s = hold(close(84, reversed), side);
    const target = 1 - side, before = s.fighters.map(f => f.x), dir = s.fighters[side].facing;
    for (let age = 1; age <= 35; age++) {
      s = tick(s);
      assert.equal(s.fighters[target].hp, 100);
      assert.deepEqual(s.fighters.map(f => f.x), before);
      assert.equal(s.grabEvents.length, 0);
    }
    s = tick(s);
    assert.equal(s.fighters[target].hp, 82);
    assert.equal(s.fighters[target].x, before[target] + dir * 48);
    assert.equal(s.fighters[side].x, before[side]);
    assert.deepEqual(s.grabEvents.map(e => [e.kind, e.damage]), [['impact', 18]]);
    for (let i = 0; i < 50; i++) {
      s = tick(s);
      assert.equal(s.fighters[target].hp, 82);
      assert.equal(s.grabEvents.length, 0);
    }
  }
});

test('G12: attacker frees at H54, target posture stays locked through H71, and the pair clears at H72', () => {
  for (const side of [0, 1]) for (const crouch of [false, true]) {
    let s = hold(close(), side, input({ crouch }));
    for (let age = 1; age <= 72; age++) {
      s = tickSide(s, side, input({ crouch: true }), input({ crouch: !crouch }));
      assert.equal(s.fighters[side].action, age < 54 ? 'grab' : 'free');
      assert.equal(s.fighters[side].posture, age < 54 ? 'stand' : 'crouch');
      assert.equal(s.fighters[1 - side].action, age < 72 ? 'grab' : 'free');
      assert.equal(s.fighters[1 - side].posture, (age < 72 ? crouch : !crouch) ? 'crouch' : 'stand');
      assert.equal(s.grabPair?.age ?? null, age < 72 ? age : null);
    }
  }
});

test('G13: new escape chords at H+1/H+12 succeed; H+13 cannot avoid impact', () => {
  for (const side of [0, 1]) for (const age of [1, 12, 13]) {
    let s = hold(close(), side);
    s = advance(s, age - 1);
    s = tickSide(s, side, N, chord());
    if (age <= 12) {
      assert.equal(s.grabPair, null);
      assert.equal(s.grabEvents[0].kind, 'escape');
      s = advance(s, 80);
      assert.deepEqual(s.fighters.map(f => f.hp), [100, 100]);
    } else {
      assert.equal(s.grabPair?.attacker, side);
      s = advance(s, 36 - age);
      assert.equal(s.fighters[1 - side].hp, 82);
    }
  }
});

test('G14: escape requires two fresh held hands with a gap at most 3 ticks', () => {
  for (const first of [8, 9]) {
    let s = advance(hold(), first - 1);
    s = tick(s, N, oneHand('lp'));
    s = advance(s, 12 - first - 1);
    s = tick(s, N, oneHand('hp'));
    assert.equal(s.grabPair === null, first === 9);
    assert.equal(s.grabEvents.some(e => e.kind === 'escape'), first === 9);
  }
});

test('G15: a fresh H0 hand seeds escape through H3, but H4 is outside the hand window', () => {
  for (const side of [0, 1]) for (const crouch of [false, true])
    for (const first of ['lp', 'hp']) for (const gap of [1, 3, 4]) {
      let s = advance(begin(close(), side), 5);
      s = tickSide(s, side, N, { ...oneHand(first), crouch });
      assert.equal(s.grabPair?.age, 0);
      s = advance(s, gap - 1);
      s = tickSide(s, side, N, oneHand(first === 'lp' ? 'hp' : 'lp'));
      assert.deepEqual(s.grabEvents.map(e => e.kind), gap <= 3 ? ['escape'] : []);
      assert.equal(s.grabPair === null, gap <= 3);
      s = advance(s, H1.grab.impact);
      assert.equal(s.fighters[1 - side].hp, gap <= 3 ? 100 : 82);
      assert.ok(s.fighters.every(f => f.attack === null));
    }
});

test('G29/H0: a new overlapping chord escapes immediately in either role, posture and attack phase', () => {
  for (const side of [0, 1]) for (const reversed of [false, true])
    for (const condition of ['stand', 'crouch', 'startup', 'recovery'])
      for (const first of ['lp', 'hp']) for (const release of [false, true]) {
        let s = close(84, reversed);
        if (condition === 'recovery') {
          s = tickSide(s, side, input({ crouch: true }), kick());
          for (let i = 0; i < 16; i++) s = tickSide(s, side, input({ crouch: true }));
        }
        s = begin(s, side, condition === 'startup' ? input({ attacks: ['hp'] }) : N);
        s = advance(s, 5);
        const second = first === 'lp' ? 'hp' : 'lp';
        const edges = [hand(first, true), hand(second, true)];
        if (release) edges.push(hand(second, false), hand(first, false));
        const before = s.fighters.map(f => f.x);
        s = tickSide(s, side, N, chord({ crouch: condition === 'crouch', handEvents: edges }));
        assert.equal(s.grabPair, null);
        assert.deepEqual(s.grabEvents.map(e => [e.kind, e.attacker, e.target, e.damage]), [['escape', side, 1 - side, 0]]);
        assert.deepEqual(s.fighters.map(f => f.grab?.kind), ['escape', 'escape']);
        assert.deepEqual(s.fighters.map(f => f.x), [before[0] + (reversed ? 16 : -16), before[1] + (reversed ? -16 : 16)]);
        for (let age = 1; age <= H1.grab.impact + 1; age++) {
          s = tick(s);
          assert.deepEqual(s.fighters.map(f => f.hp), [100, 100]);
          assert.equal(s.grabEvents.length, 0);
          assert.ok(s.fighters.every(f => f.attack === null));
        }
      }
});

test('G30/H0: pre-capture hands, repeats, non-overlap and legacy multi-hand pulses cannot prebuffer escape', () => {
  for (const side of [0, 1]) for (const condition of ['old-hand', 'repeat', 'old-tap', 'non-overlap', 'legacy']) {
    let s = advance(begin(close(), side), 4);
    const prior = condition === 'old-hand' ? oneHand('lp')
      : condition === 'repeat' ? chord({ handEvents: [hand('lp', true), hand('hp', true)] })
      : condition === 'old-tap' ? chord() : N;
    s = tickSide(s, side, N, prior);
    const current = condition === 'old-hand' ? oneHand('hp')
      : condition === 'repeat' ? chord({ handEvents: [hand('lp', true), hand('hp', true)] })
      : condition === 'non-overlap' ? chord({ handEvents: [hand('lp', true), hand('lp', false), hand('hp', true), hand('hp', false)] })
      : condition === 'legacy' ? input({ attacks: ['lp', 'hp'] }) : N;
    s = tickSide(s, side, N, current);
    assert.equal(s.grabPair?.age, 0, condition);
    assert.deepEqual(s.grabEvents.map(e => e.kind), ['hold']);
    s = advance(s, H1.grab.impact);
    assert.equal(s.fighters[1 - side].hp, 82);
  }
});

test('G31/H0: ordinary contact still wins when its attacker presses a capture-frame escape chord', () => {
  for (const side of [0, 1]) {
    let s = begin(close(), side, input({ attacks: ['lp'] }));
    s = advance(s, 5);
    s = tickSide(s, side, N, chord());
    assert.equal(s.grabPair, null);
    assert.equal(s.grabEvents.length, 0);
    assert.equal(s.events.length, 1);
    assert.equal(s.events[0].attacker, 1 - side);
    assert.equal(s.fighters[side].hp, 92);
    assert.equal(s.fighters[side].action, 'hit');
  }
});

test('G32/H0: capture-frame escape survives the final match tick once without hold or future impact', () => {
  for (const side of [0, 1]) {
    let m = matchWith(advance(begin(close(), side), 5), 1);
    m = matchTick(m, side === 0 ? N : chord(), side === 0 ? chord() : N);
    assert.deepEqual(m.result, { reason: 'timeout-tie', winner: null });
    assert.deepEqual(m.combat.grabEvents.map(e => e.kind), ['escape']);
    noExecutableGrab(m.combat);
    assert.ok(m.combat.fighters.every(f => f.grabSnapshot?.kind === 'escape'));
    const ended = structuredClone(m.combat);
    for (let i = 0; i < 40; i++) m = matchTick(m, chord(), chord());
    assert.deepEqual(m.combat, ended);
  }
});

test('G33/H0: pause discards the new capture-frame first hand without moving the throw clock', () => {
  let m = matchWith(advance(begin(), 5));
  m = matchTick(m, N, oneHand('lp'));
  assert.equal(m.combat.grabPair.age, 0);
  assert.notEqual(m.combat.fighters[1].hands.downAt.lp, null);
  m = pauseMatch(m, true);
  assert.equal(m.combat.grabPair.age, 0);
  assert.equal(m.combat.fighters[1].hands.downAt.lp, null);
  m = pauseMatch(m, false);
  m = matchTick(m, N, oneHand('hp'));
  assert.equal(m.combat.grabPair.age, 1);
  assert.equal(m.combat.grabEvents.length, 0);
});

test('G16: unrelated kick presses do not block a valid escape and never become buffered attacks', () => {
  let s = hold();
  s = tick(s, N, chord({ attacks: ['lp', 'hp', 'lk', 'hk'] }));
  assert.equal(s.grabEvents[0].kind, 'escape');
  s = advance(s, 20);
  assert.equal(s.fighters[1].attack, null);
  assert.deepEqual(s.fighters.map(f => f.hp), [100, 100]);
});

test('G17: escape locks both sides through T+11; new actions begin at T+12', () => {
  let s = tick(hold(), N, chord());
  for (let age = 1; age <= 11; age++) {
    s = tick(s, kick(), kick());
    assert.ok(s.fighters.every(f => f.action === 'grab' && f.attack === null));
  }
  s = tick(s, kick(), kick());
  assert.ok(s.fighters.every(f => f.grab === null && f.attack?.key === 'stand-hk' && f.attack.age === 0));
});

test('G18: impact and escape clip against either corner without swapping roots', () => {
  for (const targetOnRight of [false, true]) {
    const make = () => {
      const s = close(84, !targetOnRight);
      s.fighters[1].x = targetOnRight ? 1200 : 80;
      s.fighters[0].x = s.fighters[1].x + (targetOnRight ? -84 : 84);
      return s;
    };
    let s = advance(hold(make()), 36);
    assert.equal(s.fighters[1].x, targetOnRight ? 1200 : 80);
    assert.equal(s.fighters[1].hp, 82);
    const before = make().fighters.map(f => f.x);
    s = tick(hold(make()), N, chord());
    assert.equal(s.fighters[1].x, before[1]);
    assert.equal(s.fighters[0].x, before[0] + (targetOnRight ? -16 : 16));
    assert.ok(Math.abs(s.fighters[1].x - s.fighters[0].x) >= 72);
  }
});

test('G19: H72 relation cleanup preserves the attacker basic started at H54 without hitting the downed target', () => {
  for (const side of [0, 1]) {
    let s = advance(hold(close(), side), 53);
    s = tickSide(s, side, kick());
    assert.equal(s.fighters[side].attack?.key, 'stand-hk');
    const id = s.fighters[side].attack.serial;
    for (let age = 55; age <= 72; age++) {
      s = tick(s);
      assert.equal(s.fighters[1 - side].hp, 82);
      assert.equal(s.events.length, 0);
      assert.equal(s.fighters[side].attack?.serial, id);
      assert.equal(s.fighters[side].attack.age, age - 54);
    }
    assert.equal(s.grabPair, null);
    assert.equal(s.fighters[1 - side].action, 'free');
  }
});

test('G20: pending escape is discarded by pause without advancing either lock', () => {
  let m = matchWith(advance(hold(), 9));
  m = matchTick(m, N, oneHand('lp'));
  const age = m.combat.grabPair.age, positions = m.combat.fighters.map(f => f.x);
  const paused = pauseMatch(m, true);
  assert.equal(paused.combat.grabPair.age, age);
  assert.deepEqual(paused.combat.fighters.map(f => f.x), positions);
  for (let i = 0; i < 20; i++) assert.equal(matchTick(paused, chord(), chord()), paused);
  m = pauseMatch(paused, false);
  m = matchTick(m, N, oneHand('hp'));
  assert.equal(m.combat.grabPair?.age, 11);
  m = matchTick(m, N, input({ attacks: ['lp', 'hp'], handEvents: [
    hand('lp', false), hand('hp', false), hand('lp', true), hand('hp', true),
  ] }));
  assert.equal(m.combat.grabPair, null);
  assert.equal(m.combat.grabEvents[0].kind, 'escape');
});

test('G21: pausing a grab attempt preserves age and pose; pending hands cannot leak back', () => {
  let s = advance(begin(), 4);
  const snapshot = structuredClone(s);
  const cleared = clearComboInputs(s);
  assert.deepEqual(cleared.fighters.map(f => f.grab), snapshot.fighters.map(f => f.grab));
  assert.equal(cleared.frame, snapshot.frame);
  s = advance(cleared, 2);
  assert.equal(s.grabPair?.age, 0);
});

test('G22: final match tick applies H36 impact, but H35 timeout never applies future damage', () => {
  for (const endAge of [35, 36, 54, 71]) {
    let m = matchWith(hold(), endAge);
    for (let age = 1; age <= endAge; age++) m = matchTick(m);
    assert.equal(m.combat.fighters[1].hp, endAge === 35 ? 100 : 82);
    assert.equal(m.result.reason, endAge === 35 ? 'timeout-tie' : 'timeout');
    assert.equal(m.result.winner, endAge === 35 ? null : 0);
    noExecutableGrab(m.combat);
    assert.ok(m.combat.fighters.some(f => f.grabSnapshot), 'last visual survives lock cleanup');
    const combat = structuredClone(m.combat);
    for (let i = 0; i < 40; i++) m = matchTick(m, chord(), chord());
    assert.deepEqual(m.combat, combat);
    const fresh = nextRound(m);
    assert.equal(fresh.phase, 'playing');
    noExecutableGrab(fresh.combat);
    assert.ok(fresh.combat.fighters.every(f => f.grabSnapshot === null));
  }
});

test('G23: impact KO clamps health, beats timeout, and uses the existing 18F result wait', () => {
  const fixture = close();
  fixture.fighters[1].hp = 9;
  let m = matchWith(hold(fixture), 36);
  for (let i = 0; i < 36; i++) m = matchTick(m);
  assert.deepEqual(m.result, { reason: 'ko', winner: 0 });
  assert.equal(m.combat.fighters[1].hp, 0);
  assert.equal(m.combat.fighters[1].action, 'ko');
  assert.equal(m.combat.ended, true);
  noExecutableGrab(m.combat);
  assert.equal(resultReady(m), false);
  for (let i = 0; i < 17; i++) m = matchTick(m);
  assert.equal(resultReady(m), false);
  m = matchTick(m);
  assert.equal(resultReady(m), true);
  assert.deepEqual(m.wins, [1, 0]);
});

test('G24: full match restart removes final grab snapshots and every lock/input reservation', () => {
  let m = matchWith(hold(), 36);
  m.wins = [1, 0];
  for (let i = 0; i < 36; i++) m = matchTick(m);
  assert.equal(m.phase, 'match-result');
  m = restartMatch(m);
  assert.equal(m.phase, 'ready');
  assert.deepEqual(m.wins, [0, 0]);
  assert.equal(m.combat.frame, 0);
  noExecutableGrab(m.combat);
  assert.ok(m.combat.fighters.every(f => f.grabSnapshot === null && f.action === 'free'));
});

test('G25: combat ticks and pause cleanup do not mutate earlier hands, pairs, events or fighters', () => {
  let s = begin();
  for (let i = 0; i < 80; i++) {
    const before = structuredClone(s);
    const next = tick(s, N, i === 9 ? oneHand('lp') : N);
    assert.deepEqual(s, before);
    s = next;
  }
  s = tick(hold(), N, oneHand('lp'));
  const before = structuredClone(s);
  clearComboInputs(s);
  assert.deepEqual(s, before);
});

test('G26: a missed grab remains a catchable target during its ordinary recovery', () => {
  for (const side of [0, 1]) {
    const other = 1 - side;
    let s = advance(begin(close(100), other), 8);
    assert.equal(s.fighters[other].grab?.age, 8);
    const toward = s.fighters[side].x < s.fighters[other].x ? 1 : -1;
    s = tickSide(s, side, input({ axis: toward }));
    assert.equal(Math.abs(s.fighters[0].x - s.fighters[1].x), 96);
    s = hold(s, side);
    assert.equal(s.grabPair?.attacker, side);
    assert.equal(s.fighters[other].grab?.kind, 'success');
  }
});

test('G27: commands during success are discarded; target can counter-grab when recovery expires', () => {
  const fixture = close(84);
  fixture.fighters[0].x = 1116;
  fixture.fighters[1].x = 1200;
  let s = hold(fixture);
  // Start after the escape window: these inputs must neither escape nor queue
  // an action for H54/H72.
  s = advance(s, 13);
  for (let age = 14; age <= 53; age++) {
    s = tick(s, chord(), chord());
    assert.equal(s.fighters[0].grab?.kind, 'success');
    assert.equal(s.fighters[1].grab?.kind, 'success');
  }
  s = tick(s);
  assert.equal(s.fighters[0].action, 'free');
  assert.equal(s.fighters[0].grab, null);
  for (let age = 55; age <= 71; age++) {
    s = tick(s, N, chord());
    assert.equal(s.fighters[1].grab?.kind, 'success');
  }
  s = tick(s);
  assert.equal(s.fighters[1].action, 'free');
  assert.equal(s.fighters[1].grab, null);
  assert.equal(s.grabPair, null);
  s = tick(s, N, chord()); // A genuinely new counter-grab starts at H73.
  assert.equal(s.fighters[1].grab?.kind, 'attempt');
  s = advance(s, 5);
  assert.equal(s.fighters[0].action, 'free');
  assert.equal(s.fighters[1].grab?.age, 5);
  s = tick(s);
  assert.equal(s.grabPair?.attacker, 1);
  assert.equal(s.fighters[0].grab?.role, 'target');
});

test('G28 regression: a fighter without its own grab definition can escape and finish the owner recovery', () => {
  for (const side of [0, 1]) {
    const targetDefinition = structuredClone(H1);
    delete targetDefinition.grab;
    const owner = structuredClone(H1);
    // A distinct fixture duration catches accidental use of H1's fallback/default value.
    owner.grab.escapeRecovery = 15;
    const definitions = side === 0 ? [owner, targetDefinition] : [targetDefinition, owner];
    let s = createCombat(definitions);
    s.fighters[0].x = 500; s.fighters[1].x = 584;
    s = hold(s, side);
    for (const f of s.fighters) {
      assert.equal(f.grab.impactAt, owner.grab.impact);
      assert.equal(f.grab.techUntil, owner.grab.techWindow);
    }
    s = tickSide(s, side, N, chord());
    assert.deepEqual(s.grabEvents.map(e => e.kind), ['escape']);
    assert.equal(s.grabPair, null);
    assert.deepEqual(s.fighters.map(f => f.hp), [100, 100]);
    for (let age = 1; age < 15; age++) {
      s = tick(s);
      assert.ok(s.fighters.every(f => f.action === 'grab'), `both locks must remain at T+${age}`);
    }
    s = tick(s);
    assert.ok(s.fighters.every(f => f.action === 'free' && f.grab === null));
    s = tickSide(s, side, N, input({ attacks: ['lp'] }));
    assert.equal(s.fighters[1 - side].attack?.key, 'stand-lp');
    assert.equal(s.fighters[1 - side].attack.age, 0);
  }
});

test('G34: a basic active across H70 to H72 ignores down/get-up and hits on the first free tick', () => {
  for (const side of [0, 1]) for (const reversed of [false, true]) {
    let s = advance(hold(close(84, reversed), side), 59);
    s = tickSide(s, side, input({ attacks: ['hp'] })); // H60: active at H70..72.
    const serial = s.fighters[side].attack.serial;
    for (let age = 61; age <= 71; age++) {
      s = tick(s);
      assert.equal(s.fighters[1 - side].hp, 82);
      assert.equal(s.events.length, 0);
      assert.equal(s.fighters[1 - side].grab?.kind, 'success');
    }
    s = tick(s);
    assert.equal(s.grabPair, null);
    assert.equal(s.fighters[1 - side].grab, null);
    assert.equal(s.fighters[1 - side].hp, 70);
    assert.equal(s.fighters[1 - side].action, 'hit');
    assert.deepEqual(s.events.map(e => [e.attacker, e.attackId, e.damage]), [[side, serial, 12]]);
  }
});

test('G35: early regrabs cannot hit a downed target; a grab active on H72 creates a new pair once', () => {
  for (const side of [0, 1]) for (const reversed of [false, true]) for (const start of [54, 66]) {
    const fixture = close(84, reversed), target = 1 - side;
    const direction = fixture.fighters[target].x > fixture.fighters[side].x ? 1 : -1;
    fixture.fighters[target].x = direction === 1 ? 1200 : 80;
    fixture.fighters[side].x = fixture.fighters[target].x - direction * 84;
    let s = advance(hold(fixture, side), start - 1);
    const oldSerial = s.grabPair.serial;
    s = tickSide(s, side, chord());
    const newSerial = s.fighters[side].grab.serial;
    assert.notEqual(newSerial, oldSerial);
    for (let age = start + 1; age <= 71; age++) {
      s = tick(s);
      assert.equal(s.grabPair.serial, oldSerial);
      assert.equal(s.grabEvents.length, 0);
      assert.equal(s.fighters[target].hp, 82);
      assert.equal(s.fighters[target].grab.kind, 'success');
    }
    s = tick(s);
    assert.equal(s.fighters[target].hp, 82);
    if (start === 66) {
      assert.equal(s.grabPair?.serial, newSerial);
      assert.equal(s.grabPair.age, 0);
      assert.deepEqual(s.grabEvents.map(e => e.kind), ['hold']);
    } else {
      assert.equal(s.grabPair, null);
      assert.equal(s.fighters[target].action, 'free');
      assert.equal(s.grabEvents.length, 0);
    }
  }
});

test('G36: pause freezes pre-impact, down and get-up; resume advances exactly one tick', () => {
  for (const age of [35, 36, 53, 54, 71]) {
    let m = matchWith(advance(hold(), age));
    const before = structuredClone(m.combat);
    m = pauseMatch(m, true);
    for (let i = 0; i < 30; i++) assert.equal(matchTick(m, chord(), chord()), m);
    assert.deepEqual(m.combat, before);
    m = pauseMatch(m, false);
    m = matchTick(m);
    assert.equal(m.combat.frame, before.frame + 1);
    assert.equal(m.combat.grabPair?.age ?? null, age === 71 ? null : age + 1);
    assert.deepEqual(m.combat.grabEvents.map(e => e.kind), age === 35 ? ['impact'] : []);
    assert.equal(m.combat.fighters[1].hp, 82);
    assert.equal(m.combat.fighters[1].action, age === 71 ? 'free' : 'grab');
  }
});
