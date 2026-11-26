import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatInputBuffer } from '../src/input/combat-input.ts';
import { createCombat, stepCombat, clearComboInputs, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';

const neutralPhysical = { ...N, handEvents: [] };
const hand = (slot, down) => ({ slot, down });
function session(distance = 90) {
  let state = createCombat();
  state.fighters[0].x = 500; state.fighters[1].x = 500 + distance;
  const buffer = new CombatInputBuffer();
  return {
    buffer,
    get state() { return state; },
    tick(other = N) { state = stepCombat(state, [buffer.sample(), other]); return state; },
    down(...codes) { codes.forEach(code => buffer.keyDown(code)); },
    up(...codes) { codes.forEach(code => buffer.keyUp(code)); },
    tap(code) { buffer.keyDown(code); buffer.keyUp(code); },
    wait(frames) { for (let i = 0; i < frames; i++) this.tick(); return state; },
    pause() { buffer.reset(); state = clearComboInputs(state); },
  };
}
const fighter = s => s.state.fighters[0];
const isGrab = s => fighter(s).action === 'grab';

test('G1 input: ordered hand edges distinguish overlap from separate taps and survive release before sample', () => {
  const overlap = new CombatInputBuffer();
  overlap.keyDown('KeyU'); overlap.keyDown('KeyI'); overlap.keyUp('KeyI'); overlap.keyUp('KeyU');
  const overlappingSample = overlap.sample();
  assert.deepEqual(overlappingSample.attacks, ['hp', 'lp']);
  assert.deepEqual(overlappingSample.handEvents, [hand('lp', true), hand('hp', true), hand('hp', false), hand('lp', false)]);
  assert.deepEqual(overlap.sample(), neutralPhysical);
  const separate = new CombatInputBuffer();
  for (const code of ['KeyU', 'KeyI']) { separate.keyDown(code); separate.keyUp(code); }
  const separatedSample = separate.sample();
  assert.deepEqual(separatedSample.attacks, overlappingSample.attacks);
  assert.deepEqual(separatedSample.handEvents, [hand('lp', true), hand('lp', false), hand('hp', true), hand('hp', false)]);
  overlap.keyDown('KeyU'); overlap.sample();
  assert.deepEqual(overlappingSample.handEvents, [hand('lp', true), hand('hp', true), hand('hp', false), hand('lp', false)], 'later samples must not mutate an earlier edge list');
});

test('G1 input: repeats, duplicate releases and non-hand keys do not create hand edges', () => {
  const b = new CombatInputBuffer();
  b.keyUp('KeyU'); b.keyDown('KeyU'); b.keyDown('KeyU', true); b.keyDown('KeyU');
  for (const key of ['KeyJ', 'KeyK', 'KeyW', 'KeyS']) { b.keyDown(key); b.keyUp(key); }
  assert.deepEqual(b.sample().handEvents, [hand('lp', true)]);
  b.keyDown('KeyU', true); assert.deepEqual(b.sample().handEvents, []);
  b.keyUp('KeyU'); b.keyUp('KeyU'); assert.deepEqual(b.sample().handEvents, [hand('lp', false)]);
});

test('G1 input: reset removes unsampled edges and held keys require release before a new down', () => {
  const b = new CombatInputBuffer();
  b.keyDown('KeyU'); b.keyDown('KeyI'); b.reset();
  assert.deepEqual(b.sample(), neutralPhysical);
  b.keyDown('KeyU'); b.keyDown('KeyI', true); assert.deepEqual(b.sample(), neutralPhysical);
  b.keyUp('KeyU'); b.keyUp('KeyI'); assert.deepEqual(b.sample(), neutralPhysical);
  b.keyDown('KeyI'); assert.deepEqual(b.sample().handEvents, [hand('hp', true)]);
  b.reset(); b.keyUp('KeyI');
  b.keyDown('KeyU', false, false); b.keyDown('KeyU'); assert.deepEqual(b.sample(), neutralPhysical);
  b.keyUp('KeyU'); b.keyDown('KeyU'); assert.deepEqual(b.sample().handEvents, [hand('lp', true)]);
});

test('G1 combat: held single hands wait exactly 3F; releasing or tapping starts at age0 immediately', () => {
  for (const [code, key] of [['KeyU', 'stand-lp'], ['KeyI', 'stand-hp']]) {
    const held = session(); held.down(code); held.tick();
    assert.equal(fighter(held).attack, null);
    held.wait(2); assert.equal(fighter(held).attack, null);
    held.tick(); assert.equal(fighter(held).attack.key, key); assert.equal(fighter(held).attack.age, 0);
    const released = session(); released.down(code); released.tick(); released.up(code); released.tick();
    assert.equal(fighter(released).attack.key, key); assert.equal(fighter(released).attack.age, 0);
    const tap = session(); tap.tap(code); tap.tick();
    assert.equal(fighter(tap).attack.key, key); assert.equal(fighter(tap).attack.age, 0);
  }
});

test('G1 combat: either hand order grabs at gap0/3 with overlap, but gap4 cannot rewind a punch', () => {
  for (const [first, second, key] of [['KeyU', 'KeyI', 'stand-lp'], ['KeyI', 'KeyU', 'stand-hp']]) {
    for (const gap of [0, 3, 4]) {
      const s = session(); s.down(first);
      if (gap > 0) { s.tick(); s.wait(gap - 1); }
      s.down(second); s.tick();
      if (gap <= 3) { assert.equal(isGrab(s), true, `${first} gap${gap}`); assert.equal(fighter(s).attack, null); }
      else { assert.equal(isGrab(s), false); assert.equal(fighter(s).attack.key, key); assert.equal(fighter(s).attack.age, 1); }
    }
  }
});

test('G1 combat: completed overlap remains a grab after both releases; nonoverlapping same-F taps choose I', () => {
  for (const first of ['KeyU', 'KeyI']) {
    const second = first === 'KeyU' ? 'KeyI' : 'KeyU';
    const overlap = session(); overlap.down(first, second); overlap.up(second, first); overlap.tick();
    assert.equal(isGrab(overlap), true);
    const separate = session(); separate.tap(first); separate.tap(second); separate.tick();
    assert.equal(isGrab(separate), false); assert.equal(fighter(separate).attack.key, 'stand-hp');
  }
});

test('G1 combat: a pending hand released before the other hand commits only the pending punch', () => {
  for (const [first, second, key] of [['KeyU', 'KeyI', 'stand-lp'], ['KeyI', 'KeyU', 'stand-hp']]) {
    const s = session(); s.down(first); s.tick(); s.up(first); s.down(second); s.tick();
    assert.equal(fighter(s).attack.key, key); assert.equal(fighter(s).attack.age, 0); assert.equal(isGrab(s), false);
    s.wait(40); assert.equal(fighter(s).nextAttackId, 2, 'the discarded second hand cannot replay after recovery');
  }
});

test('G1 combat: valid hand overlap consumes feet even when the foot follows the second hand', () => {
  for (const prior of [false, true]) for (const foot of ['KeyJ', 'KeyK']) {
    const s = session(); s.down('KeyU'); if (prior) s.tick();
    s.down('KeyI', foot); s.tick(); assert.equal(isGrab(s), true); assert.equal(fighter(s).attack, null);
  }
});

test('G1 combat: non-combination foot conflicts use K>I>J>U and remove the hand wait', () => {
  for (const [handKey, foot, expected] of [['KeyU', 'KeyJ', 'stand-lk'], ['KeyU', 'KeyK', 'stand-hk'], ['KeyI', 'KeyJ', 'stand-hp'], ['KeyI', 'KeyK', 'stand-hk']]) {
    for (const prior of [false, true]) {
      const s = session(); s.down(handKey); if (prior) s.tick(); s.down(foot); s.tick();
      assert.equal(fighter(s).attack.key, expected); assert.equal(fighter(s).attack.age, 0);
    }
  }
  const release = session(); release.down('KeyU'); release.tick(); release.up('KeyU'); release.down('KeyI', 'KeyK'); release.tick();
  assert.equal(fighter(release).attack.key, 'stand-hk');
});

test('G1 regression: a failed opposite hand cannot outrank the pending hand and a new foot', () => {
  for (const [first, second, foot, expected] of [
    ['KeyU', 'KeyI', 'KeyJ', 'stand-lk'],
    ['KeyU', 'KeyI', 'KeyK', 'stand-hk'],
    ['KeyI', 'KeyU', 'KeyJ', 'stand-hp'],
    ['KeyI', 'KeyU', 'KeyK', 'stand-hk'],
  ]) {
    const s = session();
    s.down(first); s.tick();
    s.up(first); s.down(second, foot); s.tick();
    assert.equal(fighter(s).attack?.key, expected, `${first} up, ${second}+${foot}`);
    assert.equal(fighter(s).attack.age, 0);
    assert.equal(fighter(s).hands.pending, null);
    s.wait(60);
    assert.equal(fighter(s).attack, null);
    assert.equal(fighter(s).nextAttackId, 2, 'discarded opposite hand must not replay after recovery');
  }
});

test('G1 combat: initial W is consumed by hand waiting or a grab and never bypasses the 3F delay', () => {
  const single = session(); single.down('KeyW', 'KeyU'); single.tick();
  assert.equal(fighter(single).grounded, true); assert.equal(fighter(single).attack, null);
  single.wait(2); assert.equal(fighter(single).attack, null); assert.equal(fighter(single).grounded, true);
  single.tick(); assert.equal(fighter(single).attack.key, 'stand-lp'); assert.equal(fighter(single).attack.age, 0);
  const both = session(); both.down('KeyW', 'KeyU', 'KeyI'); both.tick();
  assert.equal(isGrab(both), true); assert.equal(fighter(both).grounded, true);
});

test('G1 combat: W/S arriving during the hand wait cancels it and discards all attack keys on that tick', () => {
  for (const direction of ['KeyW', 'KeyS']) {
    const s = session(); s.down('KeyU'); s.tick(); s.down(direction, 'KeyI', 'KeyK'); s.tick();
    assert.equal(fighter(s).attack, null); assert.equal(isGrab(s), false);
    assert.equal(fighter(s).grounded, direction !== 'KeyW');
    if (direction === 'KeyS') assert.equal(fighter(s).posture, 'crouch');
    s.wait(65); assert.equal(fighter(s).attack, null); assert.equal(fighter(s).nextAttackId, 1);
  }
});

test('G1 combat: initial crouched hands are immediate; crouched UI consumes only hands and leaves feet', () => {
  for (const [codes, key] of [[['KeyU'], 'crouch-lp'], [['KeyI'], 'crouch-hp'], [['KeyU', 'KeyI'], null], [['KeyU', 'KeyI', 'KeyJ'], 'crouch-lk'], [['KeyU', 'KeyI', 'KeyJ', 'KeyK'], 'crouch-hk']]) {
    const s = session(); s.down('KeyS', ...codes); s.tick();
    assert.equal(fighter(s).attack?.key ?? null, key); assert.equal(isGrab(s), false);
    if (key) assert.equal(fighter(s).attack.age, 0);
  }
});

test('G1 combat: waiting still permits walking and guard; guard contact discards the waiting punch', () => {
  const walk = session(300); walk.down('KeyD', 'KeyU'); walk.tick();
  assert.equal(fighter(walk).x, 504); assert.equal(fighter(walk).attack, null);
  walk.wait(2); assert.equal(fighter(walk).x, 512); walk.tick();
  assert.equal(fighter(walk).x, 512); assert.equal(fighter(walk).attack.key, 'stand-lp');
  const block = session();
  Object.assign(block.state.fighters[1], { action: 'attack', attack: { key: 'stand-lp', serial: 1, age: 5, hitTargets: [] } });
  block.down('KeyA', 'KeyU'); block.tick();
  assert.equal(fighter(block).action, 'guard'); assert.equal(fighter(block).hp, 100);
  block.wait(40); assert.equal(fighter(block).attack, null); assert.equal(fighter(block).nextAttackId, 1);
});

test('G1 combat: input reset drops a waiting hand and physical release is required after resume', () => {
  const s = session(); s.down('KeyU'); s.tick(); s.pause();
  s.down('KeyU'); s.wait(5); assert.equal(fighter(s).attack, null);
  s.up('KeyU'); s.tick(); assert.equal(fighter(s).attack, null, 'a blocked old release must not resurrect the dropped hand');
  s.tap('KeyU'); s.tick(); assert.equal(fighter(s).attack.key, 'stand-lp'); assert.equal(fighter(s).attack.age, 0);
});

test('G1/C: first-hand delay shifts actual U age, while linked I/J still use the C windows without G delay', () => {
  for (const quickTap of [false, true]) {
    const s = session(90), starts = [], hits = [];
    const start = quickTap ? 0 : 3;
    for (let frame = 0; frame < 80; frame++) {
      if (frame === 0) { s.down('KeyU'); if (quickTap) s.up('KeyU'); }
      if (frame === start + 3) s.down('KeyI');
      if (frame === start + 14) s.down('KeyJ');
      s.tick();
      if (fighter(s).attack?.age === 0) starts.push([frame, fighter(s).attack.key]);
      hits.push(...s.state.events.filter(e => e.attacker === 0).map(e => e.key));
    }
    assert.deepEqual(starts, [[start, 'stand-lp'], [start + 9, 'stand-hp'], [start + 22, 'stand-lk']]);
    assert.deepEqual(hits, ['stand-lp', 'stand-hp', 'stand-lk']); assert.equal(s.state.fighters[1].hp, 70);
  }
});

test('G1/C: I pressed at actual U age1/2 is lost rather than a grab or delayed follow-up', () => {
  for (const frameI of [4, 5]) {
    const s = session();
    for (let frame = 0; frame < 70; frame++) {
      if (frame === 0) s.down('KeyU'); if (frame === frameI) s.down('KeyI'); s.tick();
    }
    assert.equal(s.state.fighters[1].hp, 92); assert.equal(fighter(s).nextAttackId, 2);
  }
});
