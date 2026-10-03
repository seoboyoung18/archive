import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createCombat, stepCombat, clearGrabs, grabPoseState, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createMatch, startMatch, stepMatch, pauseMatch } from '../src/combat/match.ts';
import { H1 } from '../src/characters/h1.ts';
import { H1_POSES, combatPose } from '../src/characters/h1-poses.ts';
import * as display from '../src/characters/h1-visual.ts';

const close = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-8, `${why}: ${a} != ${b}`);
const chord = { ...N, attacks: ['lp', 'hp'], handEvents: [
  { slot: 'lp', down: true }, { slot: 'hp', down: true }, { slot: 'hp', down: false }, { slot: 'lp', down: false },
] };
const cache = new Map();

// Independent PNG oracle: every occupied row contributes its outer pixel-cell corners.
// Projecting these points is exact even when the transparent corners of the bbox are not.
function pixels(pose) {
  if (cache.has(pose)) return cache.get(pose);
  const bytes = readFileSync(new URL(`../assets/characters/h1/derived/${H1_POSES[pose]}`, import.meta.url));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.deepEqual([width, height, bytes[24], bytes[25], bytes[28]], [512, 512, 8, 6, 0]);
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const packed = inflateSync(Buffer.concat(chunks)), stride = width * 4, rgba = Buffer.alloc(stride * height);
  assert.equal(packed.length, (stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? rgba[i - 4] : 0, b = y ? rgba[i - stride] : 0;
      const c = y && x >= 4 ? rgba[i - stride - 4] : 0, p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      rgba[i] = (packed[y * (stride + 1) + 1 + x] + pred) & 255;
    }
  }
  const points = [];
  for (let y = 0; y < height; y++) {
    let left = width, right = -1;
    for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3] > 0) { left = Math.min(left, x); right = x; }
    if (right >= left) points.push([left, y], [right + 1, y], [left, y + 1], [right + 1, y + 1]);
  }
  assert.ok(points.length); cache.set(pose, points); return points;
}
const included = pose => /^(idle-[01]|crouch|(?:stand|crouch)-(?:hit|guard)|ko-[012])$/.test(pose)
  || /^(grab(?:bed)?-|throw)/.test(pose);
function extent(pose, facing, v) {
  const points = pose.startsWith('idle-') ? [...pixels('idle-0'), ...pixels('idle-1')] : pixels(pose);
  const r = v.angle * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  let left = Infinity, right = -Infinity;
  for (const [x, y] of points) {
    const wx = v.x + (x - 256) * .625 * facing * cos - (y - 512 * v.originY) * .625 * sin;
    left = Math.min(left, wx); right = Math.max(right, wx);
  }
  return [left, right];
}
const fit = ([left, right]) => Math.max(-left, Math.min(1280 - right, 0));

// The approved pre-boundary throw arc. This oracle contains no clamping of the image.
function base(f) {
  const v = { x: f.x, y: f.action === 'ko' ? 600 : f.y, angle: 0, originY: .875 };
  const g = grabPoseState(f);
  if (g?.kind !== 'success' || g.role !== 'target') return v;
  const impact = g.impactAt ?? H1.grab.impact, turn = (g.techUntil ?? H1.grab.techWindow) + 1;
  const lift = Math.min(impact, turn + Math.max(1, Math.floor((impact - turn) / 3)));
  if (g.age < turn || g.age >= impact) return v;
  const t = (g.age - turn) / (impact - turn), landing = Math.max(80, Math.min(1200, f.x - f.facing * (g.pushDistance ?? H1.grab.push)));
  v.x += f.facing * 32 * Math.sin(Math.PI * t) + (landing - f.x) * t * t;
  v.y -= 70 * Math.sin(Math.PI * t);
  if (g.age < lift) v.angle = f.facing * 20 * (g.age - turn) / Math.max(1, lift - turn);
  else {
    const flight = (g.age - lift) / Math.max(1, impact - lift);
    v.originY = .5; v.y -= 120 - 60 * flight; v.angle = f.facing * (-45 + 120 * flight);
  }
  return v;
}
const render = (s, age = 0) => display.combatVisuals(s, age);
function inspect(s, paired = false, age = 0) {
  const before = structuredClone(s), raw = s.fighters.map(base), visuals = render(s, age);
  const poses = s.fighters.map((f, i) => combatPose(f, s.definitions[i], age));
  const edges = raw.map((v, i) => extent(poses[i], s.fighters[i].facing, v));
  const shared = fit([Math.min(...edges.map(b => b[0])), Math.max(...edges.map(b => b[1]))]);
  for (let i = 0; i < 2; i++) {
    const f = s.fighters[i], v = visuals[i], pose = poses[i];
    const dx = paired ? shared : included(pose) ? fit(edges[i]) : 0;
    close(v.x, raw[i].x + dx, `${pose} ${f.x}/${f.facing} age${grabPoseState(f)?.age} minimum ${paired ? 'pair' : 'individual'} correction`);
    for (const key of ['y', 'angle', 'originY']) close(v[key], raw[i][key], `${pose} keeps original ${key}`);
    if (included(pose)) {
      const [left, right] = extent(pose, f.facing, v);
      assert.ok(left >= -1e-8 && right <= 1280 + 1e-8, `${pose} clips [${left},${right}]`);
    }
    if (!paired) assert.deepEqual(v, display.combatVisual(f, s.definitions[i], age), 'single API must keep individual correction compatibility');
  }
  assert.deepEqual(s, before, 'display must not mutate simulation or snapshots');
  return visuals;
}
const commands = (owner, a, b) => owner === 0 ? [a, b] : [b, a];
function initial({ edge = 'left', dir = 1, d = 84, posture = 'stand', owner = 0, hp = 100 } = {}) {
  const s = createCombat(), target = 1 - owner;
  const a = edge === 'left' ? dir === 1 ? 80 : 80 + d : edge === 'right' ? dir === 1 ? 1200 - d : 1200 : 640 - dir * d / 2;
  s.fighters[owner].x = a; s.fighters[target].x = a + dir * d; s.fighters[target].hp = hp;
  return { s, owner, target, targetInput: { ...N, crouch: posture === 'crouch' } };
}
function capture(options = {}) {
  const setup = initial(options); let { s } = setup;
  for (let t = 0; t <= 6; t++) s = stepCombat(s, commands(setup.owner, t === 0 ? chord : N, setup.targetInput));
  assert.equal(s.fighters[setup.owner].grab?.kind, 'success'); assert.equal(s.fighters[setup.owner].grab.age, 0);
  return { ...setup, s };
}

test('Stationary idle union is frame-stable; crouch and both guards fit corners without moving walk/jump/attacks', () => {
  for (const x of [80, 640, 1200]) for (const facing of [-1, 1]) {
    const s = createCombat(), f = s.fighters[0]; Object.assign(f, { x, facing });
    const idleX = [];
    for (const age of [0, 14, 15, 29, 30, 44, 45]) { f.age = age; idleX.push(inspect(s)[0].x); }
    assert.equal(new Set(idleX).size, 1, 'idle artwork changes must not move the display root');
    for (const posture of ['stand', 'crouch']) {
      Object.assign(f, { posture, action: 'guard', state: posture === 'stand' ? 'idle' : 'crouch' }); inspect(s);
    }
    Object.assign(f, { action: 'free', posture: 'crouch', state: 'crouch' }); inspect(s);
    for (const state of ['walk', 'jump']) for (const age of [0, 4, 20, 44]) {
      Object.assign(f, { state, age, posture: 'stand', grounded: state !== 'jump', vy: -300 }); inspect(s);
    }
    for (const [key, attack] of Object.entries(H1.attacks)) for (const age of [0, attack.startup, attack.startup + attack.active]) {
      Object.assign(f, { action: 'attack', posture: key.startsWith('crouch') ? 'crouch' : 'stand', grounded: true,
        attack: { key, age, serial: 1, hitTargets: [] } }); inspect(s);
    }
  }
});

test('Every live success frame fits both exact alpha bodies with a common offset until independent recovery', () => {
  assert.equal(typeof display.combatVisuals, 'function', 'renderers need the pair-aware API');
  for (const edge of ['left', 'right', 'center']) for (const dir of [-1, 1]) for (const d of [72, 84, 96]) for (const posture of ['stand', 'crouch']) {
    let { s } = capture({ edge, dir, d, posture });
    for (let age = 0; age <= 72; age++) {
      const v = inspect(s, age < 54);
      if (edge === 'center') for (let i = 0; i < 2; i++) close(v[i].x, base(s.fighters[i]).x, 'central throw arc is unchanged');
      if (age === 53) assert.ok(s.fighters.every(f => f.grab?.kind === 'success'));
      if (age === 54) { assert.equal(s.fighters[0].grab, null); assert.equal(s.fighters[1].grab?.age, 54); assert.ok(s.grabPair); }
      if (age === 72) { assert.ok(s.fighters.every(f => f.grab === null)); assert.equal(s.grabPair, null); }
      s = stepCombat(s, [N, N]);
    }
  }
});

test('Fresh H0/H12 escape and simultaneous grabs share their separation; H13 remains a throw and whiffs remain individual', () => {
  for (const edge of ['left', 'right']) for (const dir of [-1, 1]) for (const posture of ['stand', 'crouch']) for (const techAge of [0, 12, 13, 'simultaneous']) {
    if (techAge === 'simultaneous' && posture === 'crouch') continue; // A crouched attacker cannot start the standing grab.
    let { s, targetInput } = initial({ edge, dir, posture });
    for (let tick = 0; tick <= 19; tick++) {
      const escapeTick = techAge === 'simultaneous' ? 0 : 6 + techAge;
      s = stepCombat(s, [tick === 0 ? chord : N, tick === escapeTick ? { ...chord, crouch: posture === 'crouch' } : targetInput]);
      const g = s.fighters[0].grab;
      inspect(s, g?.kind === 'success' || g?.kind === 'escape');
      if (g?.kind === 'escape') {
        assert.equal(s.grabPair, null); assert.equal(s.fighters[0].hp, 100); assert.equal(s.fighters[1].hp, 100);
        assert.deepEqual(render(clearGrabs(s)), render(s), 'escaped end snapshots keep the same pair correction');
      }
    }
    if (techAge === 13) assert.equal(s.fighters[0].grab?.kind, 'success');
    else assert.equal(s.fighters[0].grab?.kind, techAge === 12 ? 'escape' : undefined);
  }
  for (const edge of ['left', 'right']) {
    let { s } = initial({ edge, d: 180 });
    for (let tick = 0; tick <= 33; tick++) { s = stepCombat(s, [tick === 0 ? chord : N, N]); inspect(s); }
    assert.equal(s.grabEvents.length, 0); assert.equal(s.fighters[0].grab, null); assert.equal(s.fighters[1].hp, 100);
  }
});

test('Pair identity rejects mixed snapshots, mismatched kinds/owners/serials/ages and expired locks', () => {
  const { s } = capture({ edge: 'left', dir: -1, owner: 1 }); inspect(s, true);
  const variants = [
    copy => { copy.fighters[0].grab.serial++; },
    copy => { copy.fighters[0].grab.role = copy.fighters[1].grab.role; },
    copy => { copy.fighters[0].grab.kind = 'escape'; },
    copy => { copy.fighters[0].grab.age++; },
    copy => { copy.fighters[0].grab.releaseAt = copy.fighters[0].grab.age; },
    copy => { copy.fighters[0].grabSnapshot = { ...copy.fighters[0].grab }; copy.fighters[0].grab = null; copy.fighters[0].action = 'free'; },
  ];
  for (const change of variants) { const copy = structuredClone(s); change(copy); inspect(copy); }
  inspect(clearGrabs(s), true);
  const otherOwner = capture({ edge: 'left', dir: -1, owner: 0 }).s;
  assert.equal(s.fighters[0].grab.serial, otherOwner.fighters[0].grab.serial);
  inspect(otherOwner, true); inspect(s, true); // No shared cache may confuse serial 1 owned by the opposite fighter.
});

test('H54 attacker actions and a later new grab never attach to the target old lock', () => {
  let { s } = capture({ edge: 'right', dir: 1 });
  for (let age = 1; age <= 54; age++) s = stepCombat(s, [N, N]);
  assert.equal(s.fighters[0].grab, null); inspect(s);
  const before = structuredClone(s);
  for (const action of [{ ...N, attacks: ['lp'] }, chord, { ...N, axis: -1 }]) {
    const next = stepCombat(before, [action, N]); inspect(next);
    if (next.fighters[0].grab) assert.notEqual(next.fighters[0].grab.serial, next.fighters[1].grab.serial);
  }
  for (let age = 55; age <= 72; age++) { s = stepCombat(s, [N, N]); inspect(s); }
  assert.equal(s.fighters[1].grab, null);
  s = stepCombat(s, [chord, N]);
  for (let i = 0; i < 6; i++) s = stepCombat(s, [N, N]);
  assert.equal(s.fighters[0].grab.kind, 'success'); assert.equal(s.fighters[0].grab.serial, 2); inspect(s, true);
});

test('Pause, timeout and impact KO freeze pair presentation while result age continues independently', () => {
  for (const age of [0, 12, 20, 35, 36, 53, 54, 71]) {
    let { s } = capture({ edge: 'left', dir: -1, posture: 'crouch' });
    for (let n = 0; n < age; n++) s = stepCombat(s, [N, N]);
    const live = inspect(s, age < 54), stopped = clearGrabs(s);
    for (const koAge of [0, 6, 12, 18, 100]) assert.deepEqual(inspect(stopped, age < 54, koAge), live);
    let m = pauseMatch({ ...startMatch(createMatch()), combat: s }, true);
    for (let n = 0; n < 3; n++) m = stepMatch(m, [chord, chord]);
    assert.deepEqual(render(m.combat), live);
  }
  for (const ko of [false, true]) {
    let { s } = capture({ edge: 'right', dir: 1, hp: ko ? 18 : 100 });
    for (let n = 0; n < 35; n++) s = stepCombat(s, [N, N]);
    let m = { ...startMatch(createMatch()), combat: s, remainingFrames: ko ? 100 : 1 };
    m = stepMatch(m, [N, N]); assert.equal(m.result.reason, ko ? 'ko' : 'timeout');
    assert.ok(m.combat.fighters.every(f => f.grabSnapshot?.kind === 'success'));
    const v = inspect(m.combat, true, m.resultAge);
    for (let n = 0; n < 30; n++) { m = stepMatch(m, [chord, chord]); assert.deepEqual(inspect(m.combat, true, m.resultAge), v); }
  }
});

test('Display inspection cannot change any later throw/escape combat frame or input result', () => {
  for (const tech of [false, true]) {
    let { s } = initial({ edge: 'left', dir: -1 }); let untouched = structuredClone(s);
    for (let tick = 0; tick < 90; tick++) {
      render(s); for (const f of s.fighters) display.combatVisual(f, H1);
      const input = [tick === 0 || tick === 80 ? chord : N, tech && tick === 18 ? chord : N];
      s = stepCombat(s, input); untouched = stepCombat(untouched, input); assert.deepEqual(s, untouched);
    }
  }
});
