import test from 'node:test';
import assert from 'node:assert/strict';
import { H1 } from '../src/characters/h1.ts';
import { COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createH1Ai, clearH1AiInput, stepH1Ai } from '../src/combat/h1-ai.ts';

function view(distance = 96, side = 1) {
  const fighter = (x, facing) => ({ x, y: 600, facing, grounded: true, posture: 'stand',
    action: 'free', state: 'idle', walkDirection: facing, attack: null, grab: null });
  const fighters = [fighter(500, 1), fighter(500 + distance, -1)];
  return { self: fighters[side], opponent: fighters[1 - side], selfDefinition: H1, opponentDefinition: H1 };
}
const decision = (v, state = createH1Ai()) => stepH1Ai({ ...state, untilDecision: 0 }, () => v);
const grabbing = input => input.handEvents?.length === 4;
const chord = { ...N, attacks: ['lp', 'hp'], handEvents: [
  { slot: 'lp', down: true }, { slot: 'hp', down: true },
  { slot: 'hp', down: false }, { slot: 'lp', down: false },
] };
function capture(v, owner = 0, serial = 1, phase = 'hold') {
  v.self.action = 'grab';
  v.self.grab = { kind: 'success', role: 'target', phase, owner, serial };
  return v;
}

test('AI-G policy: a close crouching free opponent receives the exact one-tick overlapping chord', () => {
  for (const side of [0, 1]) for (const distance of [95, 96, 97, 400]) {
    const v = view(distance, side); v.opponent.posture = 'crouch'; v.self.posture = 'crouch';
    const old = { ...createH1Ai(), cursor: 5 }, before = structuredClone({ old, v });
    const r = decision(v, old);
    assert.equal(r.ai.cursor, 5);
    assert.deepEqual(r.input, distance <= 96 ? chord : { ...N, axis: side === 0 ? 1 : -1 });
    assert.equal(r.ai.grabCooldown, distance <= 96 ? 120 : 0);
    assert.deepEqual({ old, v }, before);
    const next = stepH1Ai(r.ai, () => { throw Error('early observation'); });
    assert.deepEqual(next.input.attacks, []); assert.equal(next.input.handEvents, undefined);
  }
});

test('AI-G policy: visible standing guard approaches outside range and waits inside it', () => {
  for (const side of [0, 1]) for (const posture of ['stand', 'crouch']) for (const distance of [96, 97]) {
    const v = view(distance, side); v.opponent.action = 'guard'; v.opponent.posture = posture;
    const r = decision(v, { ...createH1Ai(), cursor: 6 });
    assert.deepEqual(r.input, { ...N, axis: distance > 96 ? side === 0 ? 1 : -1 : 0 });
    assert.equal(r.ai.grabCooldown, 0); assert.equal(r.ai.cursor, 6);
  }
});

test('AI-G policy: visible backward walking qualifies, but standing idle or forward walking does not', () => {
  for (const side of [0, 1]) for (const state of ['idle', 'back', 'forward']) {
    const v = view(96, side);
    v.opponent.state = state === 'idle' ? 'idle' : 'walk';
    v.opponent.walkDirection = state === 'forward' ? side === 0 ? -1 : 1 : side === 0 ? 1 : -1;
    const r = decision(v);
    assert.equal(Boolean(grabbing(r.input)), state === 'back');
    if (state !== 'back') assert.deepEqual(r.input.attacks, ['lp']);
  }
});

test('AI-G policy: unavailable targets and missing own grab definition use existing basic behavior', () => {
  for (const action of ['attack', 'hit', 'ko', 'grab']) {
    const v = view(); v.opponent.posture = 'crouch'; v.opponent.action = action;
    assert.equal(Boolean(grabbing(decision(v).input)), false);
  }
  const v = view(); v.opponent.posture = 'crouch'; v.selfDefinition = { ...H1, grab: undefined };
  assert.deepEqual(decision(v).input.attacks, ['lp']);
  v.opponent.grounded = false;
  assert.deepEqual(decision(v).input, N);
});

test('AI-G policy: visible striking danger, self guard and own action locks retain priority over grabbing', () => {
  for (const side of [0, 1]) {
    const v = view(96, side); v.opponent.posture = 'crouch'; v.opponent.action = 'attack';
    v.opponent.attack = { key: 'crouch-lk', phase: 'startup' };
    const r = decision(v);
    assert.deepEqual(r.input, { ...N, axis: side === 0 ? -1 : 1, crouch: true });
    assert.equal(r.ai.grabCooldown, 0);
    v.opponent.action = 'free'; v.opponent.attack = null;
    v.self.action = 'guard'; v.self.posture = 'crouch';
    assert.deepEqual(decision(v).input, { ...N, axis: side === 0 ? -1 : 1, crouch: true });
    for (const action of ['attack', 'hit', 'ko']) {
      v.self.action = action;
      assert.deepEqual(decision(v).input, { ...N, crouch: true });
    }
  }
});

test('AI-G policy: attempt T sets 120, next attempts are barred through T+119 and allowed at T+120', () => {
  const v = view(); v.opponent.posture = 'crouch';
  let r = decision(v); assert.equal(grabbing(r.input), true); assert.equal(r.ai.grabCooldown, 120);
  const observed = [];
  for (let frame = 1; frame <= 120; frame++) {
    r = stepH1Ai(r.ai, () => { observed.push(frame); return v; });
    assert.equal(Boolean(grabbing(r.input)), frame === 120, `frame ${frame}`);
    assert.equal(r.ai.grabCooldown, frame === 120 ? 120 : 120 - frame);
  }
  assert.deepEqual(observed, Array.from({ length: 10 }, (_, i) => (i + 1) * 12));
});

test('AI-G policy: cooldown keeps ordinary low-kick/rotation choices and decrements during unobserved locks', () => {
  const v = view(96); v.opponent.action = 'guard';
  const r = decision(v, { ...createH1Ai(), cursor: 3, grabCooldown: 50 });
  assert.deepEqual(r.input.attacks, ['lk']); assert.equal(r.input.crouch, true);
  assert.equal(r.ai.cursor, 7); assert.equal(r.ai.grabCooldown, 49);
  const locked = stepH1Ai({ ...r.ai, axis: 1, crouch: true, untilDecision: 0 }, () => { throw Error('locked observation'); }, true);
  assert.deepEqual(locked.input, N); assert.equal(locked.ai.grabCooldown, 48);
  assert.equal(locked.ai.untilDecision, 11); assert.equal(locked.ai.cursor, 7);
});

test('AI-G policy: first and third captures are allowed, second and fourth emit tech once per relation', () => {
  let ai = createH1Ai();
  for (let serial = 1; serial <= 4; serial++) {
    const v = capture(view(), 0, serial);
    const r = decision(v, { ...ai, grabCooldown: 40 }); ai = r.ai;
    assert.equal(ai.captureCount, serial); assert.deepEqual(ai.lastCapture, { owner: 0, serial });
    assert.deepEqual(r.input, serial % 2 === 0 ? chord : N);
    assert.equal(ai.grabCooldown, 39, 'tech never starts a new attempt cooldown');
    const again = decision(v, ai); ai = again.ai;
    assert.deepEqual(again.input, N); assert.equal(ai.captureCount, serial);
  }
});

test('AI-G policy: relation identity includes owner but never uses serial magnitude to choose tech', () => {
  let r = decision(capture(view(), 0, 999999));
  assert.equal(r.ai.captureCount, 1); assert.deepEqual(r.input, N);
  r = decision(capture(view(), 1, 999999), r.ai);
  assert.equal(r.ai.captureCount, 2); assert.deepEqual(r.input, chord);
  r = decision(capture(view(), 0, 1), r.ai);
  assert.equal(r.ai.captureCount, 3); assert.deepEqual(r.input, N);
});

test('AI-G policy: attempt/escape/attacker/throw/down never count as a tech-eligible capture', () => {
  for (const [kind, role, phase] of [
    ['attempt', 'attacker', 'attempt'], ['escape', 'target', 'escape'],
    ['success', 'attacker', 'hold'], ['success', 'target', 'throw'], ['success', 'target', 'down'],
  ]) {
    const v = capture(view()); Object.assign(v.self.grab, { kind, role, phase });
    const r = decision(v, { ...createH1Ai(), captureCount: 1 });
    assert.deepEqual(r.input, N); assert.equal(r.ai.captureCount, 1); assert.equal(r.ai.lastCapture, null);
  }
});

test('AI-G policy: a free thrower waits for the target success lock to end before any new approach or basic', () => {
  for (const side of [0, 1]) for (const distance of [84, 200]) for (const phase of ['hold', 'throw', 'down']) {
    const v = view(distance, side); v.opponent.action = 'grab';
    v.opponent.grab = { kind: 'success', role: 'target', phase, owner: side, serial: 1 };
    const ai = { ...createH1Ai(), cursor: 5, grabCooldown: 60 };
    const r = decision(v, ai);
    assert.deepEqual(r.input, N); assert.equal(r.ai.cursor, 5); assert.equal(r.ai.grabCooldown, 59);
    v.opponent.action = 'free'; v.opponent.grab = null;
    const free = decision(v, r.ai);
    assert.equal(distance === 84 ? free.input.attacks.length : Math.abs(free.input.axis), 1);
  }
});

test('AI-G policy: clearing input preserves policy state, while a fresh AI resets all policies', () => {
  const state = { ...createH1Ai(), cursor: 5, untilDecision: 4, axis: -1, crouch: true,
    grabCooldown: 83, captureCount: 2, lastCapture: { owner: 0, serial: 4 } };
  assert.deepEqual(clearH1AiInput(state), { ...state, axis: 0, crouch: false });
  assert.deepEqual(createH1Ai(), { cursor: 0, untilDecision: 0, axis: 0, crouch: false,
    grabCooldown: 0, captureCount: 0, lastCapture: null });
});
