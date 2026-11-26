import test from 'node:test';
import assert from 'node:assert/strict';
import { createFighters, stepMovement, NEUTRAL as M } from '../src/combat/movement.ts';
import { createCombat, stepCombat, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createMatch, startMatch, stepMatch, pauseMatch, nextRound } from '../src/combat/match.ts';
import { createH1Ai } from '../src/combat/h1-ai.ts';
import { stepH1AiMatch } from '../src/combat/h1-ai-match.ts';
import { H1 } from '../src/characters/h1.ts';

const close = (a, b, label = 'value') => assert.ok(Math.abs(a - b) < 1e-8, `${label}: ${a} != ${b}`);
const pair = (owner, a, b = N) => owner === 0 ? [a, b] : [b, a];
function scene(owner = 0, direction = 1, gap = 84) {
  const s = createCombat();
  Object.assign(s.fighters[owner], { x: 640 - direction * gap / 2, facing: direction });
  Object.assign(s.fighters[1 - owner], { x: 640 + direction * gap / 2, facing: -direction });
  return s;
}
function readyAttack(s, owner, direction, key = 'stand-hp') {
  Object.assign(s.fighters[owner], { action: 'attack', facing: direction,
    attack: { key, serial: 1, age: H1.attacks[key].startup - 1, hitTargets: [] }, nextAttackId: 2 });
}
const chord = { ...N, attacks: ['lp', 'hp'], handEvents: [
  { slot: 'lp', down: true }, { slot: 'hp', down: true }, { slot: 'hp', down: false }, { slot: 'lp', down: false },
] };

test('Directional jumps cross either player at unchanged height, duration and speed; W alone remains stationary', () => {
  for (const owner of [0, 1]) for (const direction of [-1, 1]) for (const gap of [72, 84, 96, 300]) for (const axis of [0, direction]) {
    let s = scene(owner, direction, gap); const original = structuredClone(s), start = s.fighters[owner].x, other = s.fighters[1 - owner].x;
    for (let tick = 1; tick <= 48; tick++) {
      s = stepCombat(s, pair(owner, { ...N, axis, jump: tick === 1 }));
      const f = s.fighters[owner];
      close(f.x, start + axis * tick * 4, 'unblocked horizontal motion');
      close(s.fighters[1 - owner].x, other, 'a jump does not push the grounded opponent');
      if (tick === 24) { close(f.y, 440); close(f.vy, 0); }
      if (tick < 48) { assert.equal(f.grounded, false); assert.equal(f.facing, direction); }
    }
    const f = s.fighters[owner]; assert.equal(f.grounded, true); close(f.y, 600); close(f.vy, 0);
    assert.equal(f.facing, axis && gap < 192 ? -direction : direction, 'landing immediately faces the opponent without an automatic leap to its back');
    assert.equal(f.hp, 100); assert.equal(s.fighters[1 - owner].hp, 100);
    assert.deepEqual(original.fighters.map(f => f.y), [600, 600], 'the input snapshot stays immutable');
  }
});

test('A grounded fighter can walk under a jumper and two jumpers cross symmetrically', () => {
  for (const direction of [-1, 1]) for (const owner of [0, 1]) for (const bothJump of [false, true]) {
    let s = scene(owner, direction, 84); const starts = s.fighters.map(f => f.x);
    for (let tick = 1; tick <= 30; tick++) {
      const jumping = { ...N, jump: tick === 1, axis: bothJump ? direction : 0 };
      s = stepCombat(s, pair(owner, jumping, { ...N, axis: -direction, jump: bothJump && tick === 1 }));
    }
    close(s.fighters[owner].x, starts[owner] + (bothJump ? direction * 120 : 0));
    close(s.fighters[1 - owner].x, starts[1 - owner] - direction * 120);
    assert.ok((s.fighters[owner].x - s.fighters[1 - owner].x) * direction > 0);
  }
});

test('Landing resolves the current side, exact ties preserve the previous side, and walls transfer separation', () => {
  for (const direction of [-1, 1]) for (const owner of [0, 1]) for (const priorGap of [2, 4, 6]) {
    const f = createFighters(), target = 1 - owner;
    Object.assign(f[owner], { x: 640 - direction * priorGap, y: 590, vy: 800, grounded: false, facing: direction });
    f[target].x = 640;
    const next = stepMovement(f, pair(owner, { ...M, axis: direction }, M));
    const midpoint = (640 + 640 - direction * priorGap + direction * 4) / 2;
    const newSide = priorGap < 4 ? direction : -direction;
    close(next[owner].x, midpoint + newSide * 36); close(next[target].x, midpoint - newSide * 36);
    assert.equal(next[owner].grounded, true); assert.equal(next[owner].facing, -newSide);
  }
  for (const edge of [80, 1200]) for (const owner of [0, 1]) {
    const f = createFighters(), direction = edge === 80 ? -1 : 1;
    Object.assign(f[owner], { x: edge, y: 590, vy: 800, grounded: false }); f[1 - owner].x = edge - direction;
    const next = stepMovement(f, [M, M]); close(next[owner].x, edge); close(next[1 - owner].x, edge - direction * 72);
  }
});

test('Only free landing turns immediately; hit and attack facing locks are retained', () => {
  for (const direction of [-1, 1]) for (const owner of [0, 1]) for (const action of ['free', 'hit']) {
    const s = scene(owner, direction);
    Object.assign(s.fighters[owner], { x: 640 + direction * 84, y: 590, vy: 800, grounded: false, facing: direction, action, stun: 5 });
    s.fighters[1 - owner].x = 640;
    const next = stepCombat(s, pair(owner, { ...N, crouch: true }));
    assert.equal(next.fighters[owner].grounded, true);
    assert.equal(next.fighters[owner].facing, action === 'free' ? -direction : direction);
    assert.equal(next.fighters[owner].posture, action === 'free' ? 'crouch' : 'stand');
  }
  let s = scene(); readyAttack(s, 0, 1);
  Object.assign(s.fighters[1], { x: s.fighters[0].x - 84, grounded: false, y: 440, vy: 0 });
  s = stepCombat(s, [N, N]); assert.equal(s.fighters[0].facing, 1); assert.equal(s.events.length, 0);
});

test('A same-tick crossing hit pushes away from the contact snapshot, with normal airborne hit and KO rules', () => {
  for (const owner of [0, 1]) for (const direction of [-1, 1]) for (const ko of [false, true]) {
    let s = scene(owner, direction), victim = 1 - owner;
    s.fighters[owner].x = 640; readyAttack(s, owner, direction);
    Object.assign(s.fighters[victim], { x: 640 - direction, y: 520, vy: 0, grounded: false, facing: -direction, hp: ko ? 12 : 100 });
    const before = structuredClone(s);
    s = stepCombat(s, pair(owner, N, { ...N, axis: direction, jump: true, attacks: ['hk'] }));
    assert.equal(s.events.length, 1); assert.equal(s.events[0].blocked, false); assert.equal(s.events[0].damage, 12);
    close(s.fighters[victim].x, 640 + direction * (3 + 36), 'crossing push uses this contact side');
    close(s.fighters[victim].y, 520 + 1000 / 3600); close(s.fighters[victim].vy, 2000 / 60);
    assert.equal(s.fighters[victim].attack, null); assert.equal(s.fighters[victim].action, ko ? 'ko' : 'hit');
    assert.equal(s.fighters[victim].hp, ko ? 0 : 88); assert.equal(s.ended, ko);
    assert.equal(before.fighters[victim].x, 640 - direction);
    const next = stepCombat(s, pair(owner, N, { ...N, axis: direction }));
    if (ko) assert.equal(next, s);
    else { close(next.fighters[victim].x, s.fighters[victim].x); assert.ok(next.fighters[victim].y > s.fighters[victim].y); }
  }
});

test('An airborne hit interrupts the flip until landing even when hitstun ends earlier', () => {
  for (const owner of [0, 1]) for (const direction of [-1, 1]) {
    let s = scene(owner, direction), victim = 1 - owner;
    readyAttack(s, owner, direction, 'stand-lp');
    Object.assign(s.fighters[victim], { grounded: false, y: 550, vy: -500 });
    s = stepCombat(s, [N, N]);
    assert.equal(s.fighters[victim].action, 'hit'); assert.equal(s.fighters[victim].jumpInterrupted, true);
    for (let tick = 0; tick < 17; tick++) {
      s = stepCombat(s, [N, N]); assert.equal(s.fighters[victim].grounded, false);
      assert.equal(s.fighters[victim].jumpInterrupted, true, 'hit recovery cannot resume the flip in midair');
    }
    assert.equal(s.fighters[victim].action, 'free');
    let ticks = 0;
    while (!s.fighters[victim].grounded) { s = stepCombat(s, [N, N]); assert.ok(++ticks < 40); }
    assert.equal(s.fighters[victim].jumpInterrupted, false);
    s = stepCombat(s, pair(owner, N, { ...N, jump: true }));
    assert.equal(s.fighters[victim].grounded, false); assert.equal(s.fighters[victim].jumpInterrupted, false);
  }
});

test('Landing discards airborne attack pulses and allows only already-active grounded grab contact', () => {
  for (const owner of [0, 1]) for (const direction of [-1, 1]) {
    let s = scene(owner, direction), jumper = 1 - owner;
    Object.assign(s.fighters[jumper], { y: 590, vy: 800, grounded: false });
    s = stepCombat(s, pair(owner, N, { ...N, attacks: ['hk'] }));
    assert.equal(s.fighters[jumper].grounded, true); assert.equal(s.fighters[jumper].attack, null);
    s = stepCombat(s, [N, N]); assert.equal(s.fighters[jumper].attack, null);
    for (const landing of [false, true]) {
      s = scene(owner, direction); s = stepCombat(s, pair(owner, chord));
      for (let i = 0; i < 5; i++) s = stepCombat(s, [N, N]);
      Object.assign(s.fighters[jumper], { grounded: false, y: landing ? 590 : 520, vy: landing ? 800 : 0 });
      s = stepCombat(s, [N, N]);
      assert.equal(s.grabEvents.length, landing ? 1 : 0);
      assert.equal(s.fighters[owner].grab.kind, landing ? 'success' : 'attempt');
    }
  }
});

test('Pause, time expiry and replay preserve or reset crossed jump state without replaying movement', () => {
  let m = startMatch(createMatch()); m.combat = scene();
  for (let tick = 0; tick < 30; tick++) m = stepMatch(m, [{ ...N, axis: 1, jump: tick === 0 }, N]);
  assert.ok(m.combat.fighters[0].x > m.combat.fighters[1].x); assert.equal(m.combat.fighters[0].grounded, false);
  m = pauseMatch(m, true); const paused = m;
  for (let tick = 0; tick < 10; tick++) m = stepMatch(m, [{ ...N, axis: 1, jump: true }, N]);
  assert.equal(m, paused);
  m = pauseMatch(m, false); m = { ...m, remainingFrames: 1 }; m = stepMatch(m, [N, N]);
  assert.equal(m.result.reason, 'timeout-tie'); const result = m;
  assert.equal(stepMatch(m, [{ ...N, axis: -1 }, N]), result);
  m = nextRound(m); assert.deepEqual(m.combat.fighters.map(f => [f.x, f.y, f.grounded]), [[400, 600, true], [880, 600, true]]);
});

test('Crossing does not give CPU an extra observation or change its retained input before the next decision', () => {
  for (const direction of [-1, 1]) {
    let match = startMatch(createMatch()), ai = { ...createH1Ai(), untilDecision: 11, axis: -direction };
    Object.assign(match.combat.fighters[0], { x: 640 - direction * 2, y: 500, vy: -100, grounded: false, facing: direction });
    Object.assign(match.combat.fighters[1], { x: 640, facing: -direction });
    for (let tick = 1; tick <= 12; tick++) {
      ({ match, ai } = stepH1AiMatch(match, ai, { ...N, axis: direction }));
      close(match.combat.fighters[1].x, 640 - direction * Math.min(tick, 11) * 4, 'CPU retains its chosen screen direction until the scheduled observation');
      assert.equal(match.combat.fighters[1].facing, direction, 'grounded facing follows the actual crossed position');
      assert.equal(ai.axis, tick < 12 ? -direction : 0); assert.equal(ai.cursor, 0);
      assert.equal(match.combat.fighters[1].attack, null); assert.equal(match.combat.fighters[1].grab, null);
    }
    assert.equal(ai.untilDecision, 11, 'the original 12F decision phase is preserved');
  }
});
