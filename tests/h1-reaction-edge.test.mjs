import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createCombat, stepCombat, worldRect, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createMatch, startMatch, stepMatch } from '../src/combat/match.ts';
import { H1 } from '../src/characters/h1.ts';
import { H1_POSES, combatPose } from '../src/characters/h1-poses.ts';
import { combatVisual } from '../src/characters/h1-visual.ts';
import { combatCamera, worldToScreen } from '../src/characters/h1-camera.ts';

const reactions = ['stand-hit', 'crouch-hit', 'ko-0', 'ko-1', 'ko-2'];
const koAges = [0, 5, 6, 11, 12, 18];
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-8, `${message}: ${a} != ${b}`);

// Independent asset oracle. Decode RGBA using PNG filters and include every alpha>0 pixel,
// including the faint fringe excluded by the alignment manifest's alpha>=8 threshold.
function decodeAlphaBounds(pose) {
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
  const packed = inflateSync(Buffer.concat(chunks)), stride = width * 4, pixels = Buffer.alloc(stride * height);
  assert.equal(packed.length, (stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? pixels[i - 4] : 0, b = y ? pixels[i - stride] : 0;
      const c = y && x >= 4 ? pixels[i - stride - 4] : 0, p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      pixels[i] = (packed[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  const result = {};
  for (const threshold of [1, 8]) {
    const bounds = { left: width, right: -1, top: height, bottom: -1 };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] >= threshold) {
      bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
    }
    assert.ok(bounds.right >= bounds.left, `${pose} must contain visible pixels`);
    result[threshold] = bounds;
  }
  return result;
}
const bounds = Object.fromEntries(reactions.map(pose => [pose, decodeAlphaBounds(pose)]));

function contact({ edge = 'left', posture = 'stand', ko = false, targetX, airborne = false } = {}) {
  const x = targetX ?? (edge === 'left' ? 80 : 1200), direction = edge === 'left' ? -1 : 1;
  let m = createMatch();
  m.combat.fighters[0].x = x - direction * 84; m.combat.fighters[1].x = x;
  if (ko) m.combat.fighters[1].hp = 8;
  if (airborne) Object.assign(m.combat.fighters[1], { grounded: false, y: 440, vy: 0 });
  m = startMatch(m);
  for (let tick = 0; tick < 7; tick++) m = stepMatch(m, [tick === 0 ? { ...N, attacks: ['lp'] } : N, { ...N, crouch: posture === 'crouch' }]);
  assert.equal(m.combat.fighters[1].action, ko ? 'ko' : 'hit', 'the common LP must create the reaction');
  assert.equal(m.combat.events.length, 1); assert.equal(m.combat.events[0].damage, 8);
  assert.equal(m.combat.events[0].blocked, false);
  return m;
}

function inspect(s, age = 0) {
  const f = s.fighters[1], camera = combatCamera(s);
  const pose = combatPose(f, H1, age), b = bounds[pose][1], v = combatVisual(f, H1, age);
  const offsets = [(b.left - 256) * .625 * f.facing, (b.right + 1 - 256) * .625 * f.facing];
  const left = worldToScreen(camera, v.x + Math.min(...offsets), v.y).x;
  const right = worldToScreen(camera, v.x + Math.max(...offsets), v.y).x;
  assert.ok(left >= -1e-8 && right <= 1280 + 1e-8, `${pose} x=${f.x} facing=${f.facing} age=${age}: alpha>0 clips at [${left},${right}]`);
  close(v.x, f.x, `${pose} must keep the logical world root`);
  assert.equal(v.y, f.action === 'ko' ? 600 : f.y);
  assert.equal(v.angle, 0); assert.equal(v.originY, .875); assert.equal(v.depth, f.id);
  assert.ok(v.y + (b.top - 448) * .625 >= 0);
  assert.ok(v.y + (b.bottom + 1 - 448) * .625 <= 720);
  return v;
}

test('Reaction asset oracle matches manifest alignment pixels and detects the omitted low-alpha fringe', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/characters/h1/derived/combat-v1/manifest.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(manifest.alphaThreshold, 8);
  for (const pose of reactions) assert.deepEqual(bounds[pose][8], manifest.frames.find(f => f.id === pose).outputBounds);
  for (const pose of ['stand-hit', 'crouch-hit', 'ko-0', 'ko-1']) assert.ok(bounds[pose][1].left < bounds[pose][8].left, `${pose} fringe must participate in boundary checks`);
});

for (const posture of ['stand', 'crouch']) test(`Common ${posture} hit keeps all nontransparent pixels inside both corners through the shared camera`, () => {
  for (const edge of ['left', 'right']) {
    const m = contact({ edge, posture }), f = m.combat.fighters[1];
    assert.equal(f.posture, posture); assert.equal(f.x, edge === 'left' ? 80 : 1200);
    const v = inspect(m.combat); assert.equal(v.x, f.x, 'corner reaction needs no local root correction');
  }
});

test('Common KO uses the displayed pose bounds at ages 0/5/6/11/12/18 and while the result waits', () => {
  for (const edge of ['left', 'right']) {
    let m = contact({ edge, ko: true });
    const camera = combatCamera(m.combat);
    for (let age = 0; age <= 18; age++) {
      if (koAges.includes(age)) {
        assert.equal(m.resultAge, age); assert.equal(combatPose(m.combat.fighters[1], H1, age), `ko-${Math.min(2, Math.floor(age / 6))}`);
        inspect(m.combat, m.resultAge); assert.deepEqual(combatCamera(m.combat), camera);
      }
      m = stepMatch(m, [N, N]);
    }
    const before = structuredClone(m), visual = inspect(m.combat, m.resultAge);
    for (let i = 0; i < 30; i++) m = stepMatch(m, [N, N]);
    assert.deepEqual(m, before); assert.deepEqual(combatVisual(m.combat.fighters[1], H1, m.resultAge), visual);
  }
});

test('Central reactions keep their original positions and both reflected orientations use the actual alpha extent', () => {
  for (const edge of ['left', 'right']) for (const posture of ['stand', 'crouch']) {
    const m = contact({ edge, posture, targetX: 640 }), f = m.combat.fighters[1];
    assert.equal(inspect(m.combat).x, f.x);
    // Reflection-only display fixture covers both facing signs even when that direction cannot occur at a grounded corner.
    for (const x of [80, 1200]) for (const facing of [-1, 1]) inspect({ ...m.combat, fighters: [m.combat.fighters[0], { ...f, x, facing }] });
  }
  const s = contact({ ko: true, targetX: 640 }).combat, f = s.fighters[1];
  for (const age of koAges) {
    assert.equal(inspect(s, age).x, f.x);
    for (const x of [80, 1200]) for (const facing of [-1, 1]) inspect({ ...s, fighters: [s.fighters[0], { ...f, x, facing }] }, age);
  }
});

test('Reaction display cannot mutate logical roots/hurtboxes, delay hit recovery, or alter subsequent combat', () => {
  for (const edge of ['left', 'right']) for (const posture of ['stand', 'crouch']) {
    let s = contact({ edge, posture }).combat, baseline = structuredClone(s), ticks = 0;
    while (s.fighters[1].action === 'hit') {
      const before = structuredClone(s), f = s.fighters[1], hurt = worldRect(H1.hurt[f.posture], f);
      inspect(s); assert.deepEqual(s, before); assert.deepEqual(worldRect(H1.hurt[f.posture], f), hurt);
      s = stepCombat(s, [N, N]); baseline = stepCombat(baseline, [N, N]); ticks++;
      assert.deepEqual(s, baseline); assert.ok(ticks <= H1.attacks['stand-lp'].hitstun + 1);
    }
    assert.equal(ticks, H1.attacks['stand-lp'].hitstun + 1);
    const f = s.fighters[1];
    assert.equal(f.action, 'free', 'hit recovery has no extra tween or lock');
    close(combatVisual(f, H1).x, f.x, 'reaction and recovered pose share their original world root');
  }
  const m = contact({ ko: true, airborne: true }), before = structuredClone(m);
  assert.notEqual(m.combat.fighters[1].y, 600);
  for (const age of koAges) inspect(m.combat, age);
  assert.deepEqual(m, before, 'KO display grounds only the image, never the logical airborne victim');
});

test('Successful throw and thrown-KO snapshots use their own alpha bounds independently of ordinary KO age', () => {
  const chord = { ...N, attacks: ['lp', 'hp'], handEvents: [{ slot: 'lp', down: true }, { slot: 'hp', down: true }, { slot: 'hp', down: false }, { slot: 'lp', down: false }] };
  for (const edge of ['left', 'right']) {
    const targetX = edge === 'left' ? 80 : 1200, direction = edge === 'left' ? -1 : 1;
    let s = createCombat(); s.fighters[0].x = targetX - direction * 84; s.fighters[1].x = targetX;
    s = stepCombat(s, [chord, N]); for (let tick = 0; tick < 6; tick++) s = stepCombat(s, [N, N]);
    for (let age = 0; age <= 72; age++) {
      for (const f of s.fighters) for (const koAge of koAges) assert.deepEqual(combatVisual(f, H1, koAge), combatVisual(f, H1));
      if ([36, 47, 48].includes(age)) {
        const f = s.fighters[1], b = decodeAlphaBounds(combatPose(f, H1))[1];
        const offsets = [(b.left - 256) * .625 * f.facing, (b.right + 1 - 256) * .625 * f.facing];
        const v = combatVisual(f, H1), camera = combatCamera(s);
        close(v.x, f.x, `grounded throw keeps its world root at H${age}`);
        assert.ok(worldToScreen(camera, v.x + Math.min(...offsets), v.y).x >= -1e-8);
        assert.ok(worldToScreen(camera, v.x + Math.max(...offsets), v.y).x <= 1280 + 1e-8);
      }
      s = stepCombat(s, [N, N]);
    }
    let m = createMatch(); m.combat.fighters[0].x = targetX - direction * 84; m.combat.fighters[1].x = targetX; m.combat.fighters[1].hp = 18; m = startMatch(m);
    for (let tick = 0; tick < 43; tick++) m = stepMatch(m, [tick === 0 ? chord : N, N]);
    assert.equal(m.result?.reason, 'ko'); assert.equal(m.combat.fighters[1].grab, null); assert.equal(m.combat.fighters[1].grabSnapshot?.kind, 'success');
    const before = structuredClone(m);
    for (const age of koAges) {
      assert.equal(combatPose(m.combat.fighters[1], H1, age), 'thrown-down');
      assert.equal(combatPose(m.combat.fighters[0], H1, age), 'throw-slam');
      const f = m.combat.fighters[1], b = decodeAlphaBounds('thrown-down')[1];
      const offsets = [(b.left - 256) * .625 * f.facing, (b.right + 1 - 256) * .625 * f.facing];
      const v = combatVisual(f, H1, age), camera = combatCamera(m.combat);
      close(v.x, f.x, 'thrown KO keeps its world root');
      assert.ok(worldToScreen(camera, v.x + Math.min(...offsets), v.y).x >= -1e-8);
      assert.ok(worldToScreen(camera, v.x + Math.max(...offsets), v.y).x <= 1280 + 1e-8);
      assert.deepEqual(combatVisual(m.combat.fighters[1], H1, age), combatVisual(m.combat.fighters[1], H1));
    }
    assert.deepEqual(m, before);
  }
});
