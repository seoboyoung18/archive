import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombat, stepCombat, worldRect, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createMatch, startMatch, stepMatch, pauseMatch, nextRound, restartMatch } from '../src/combat/match.ts';
import { H1 } from '../src/characters/h1.ts';
import { combatPose } from '../src/characters/h1-poses.ts';
import { combatVisuals } from '../src/characters/h1-visual.ts';
import { H1_CAMERA_MARGIN, combatCamera, worldToScreen, applyCombatCamera, configureCombatCameras } from '../src/characters/h1-camera.ts';

const close = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-8, `${why}: ${a} != ${b}`);
function roots(a, b) {
  const s = createCombat(); s.fighters[0].x = a; s.fighters[1].x = b; return s;
}
function checkFrame(s) {
  const before = structuredClone(s), c = combatCamera(s);
  const lo = Math.min(...s.fighters.map(f => f.x)) - 192, hi = Math.max(...s.fighters.map(f => f.x)) + 192;
  close(c.left, lo, 'left envelope'); close(c.right, hi, 'right envelope');
  assert.ok(c.zoom > 0 && c.zoom <= 1, 'camera must never magnify');
  close(c.zoom, Math.min(1, 1280 / (hi - lo)), 'use only the necessary shrink');
  const left = worldToScreen(c, lo, 600).x, right = worldToScreen(c, hi, 600).x;
  assert.ok(left >= -1e-8 && right <= 1280 + 1e-8);
  if (Math.abs(c.offsetX) > 1e-8) close(c.offsetX > 0 ? left : right, c.offsetX > 0 ? 0 : 1280, 'nonzero pan must stop at the first fitting edge');
  for (const f of s.fighters) close(worldToScreen(c, f.x, 600).y, 600, 'floor is anchored');
  close(c.scrollX, -c.offsetX / c.zoom, 'Phaser scroll conversion'); assert.equal(c.scrollY, 0);
  assert.deepEqual(s, before, 'framing is read-only');
  return c;
}

test('Distance camera fits a fixed 192px root envelope with the minimum pan and no enlargement', () => {
  assert.equal(H1_CAMERA_MARGIN, 192);
  const cases = [
    [400, 880, 1, 0], [80, 152, 1, 112], [1128, 1200, 1, -112],
    [80, 1200, 1280 / 1504, 0], [304, 1200, 1, -112], [80, 976, 1, 112],
    [300, 1200, 1280 / 1284, -110 * 1280 / 1284],
    [308, 1200, 1, -112], [200, 1100, 1280 / 1284, -10 * 1280 / 1284],
  ];
  for (const [a, b, zoom, pan] of cases) {
    const c = checkFrame(roots(a, b)); close(c.zoom, zoom, 'fixture zoom'); close(c.offsetX, pan, 'fixture pan');
    assert.deepEqual(combatCamera(roots(b, a)), c, 'player identity is irrelevant');
    const reflected = combatCamera(roots(1280 - a, 1280 - b));
    close(reflected.zoom, c.zoom, 'reflected zoom'); close(reflected.offsetX, -c.offsetX, 'reflected pan');
  }
});

test('Animation changes, a complete stationary jump and KO age never move the camera or the grounded root', () => {
  for (const [a, b] of [[80, 1200], [1116, 1200], [400, 880]]) {
    let s = roots(a, b); const camera = checkFrame(s), screenRoot = worldToScreen(camera, a, 600), seen = new Set();
    for (let tick = 0; tick <= 48; tick++) {
      const f = s.fighters[0], v = combatVisuals(s)[0]; seen.add(combatPose(f, H1));
      assert.deepEqual(combatCamera(s), camera);
      close(v.x, a, 'jump retains its logical x'); close(v.y, f.y - (f.grounded ? 0 : 120), 'flip pivots around the body center without moving the logical root');
      close(worldToScreen(camera, v.x, v.y).x, screenRoot.x, 'jump cannot cause horizontal camera movement');
      if (tick < 48) s = stepCombat(s, [{ ...N, jump: tick === 0 }, N]);
    }
    assert.equal(s.fighters[0].grounded, true);
    for (const pose of ['jump-rise', 'flip-lift', 'flip-fold', 'flip-tuck', 'flip-coil', 'flip-release', 'flip-open', 'jump-fall', 'flip-landing']) assert.ok(seen.has(pose));
    for (const action of ['free', 'hit', 'guard', 'ko']) for (const posture of ['stand', 'crouch']) for (const age of [0, 6, 12, 18, 47]) {
      const variant = structuredClone(s), f = variant.fighters[0];
      Object.assign(f, { action, posture, age, hp: action === 'ko' ? 0 : 50, facing: -f.facing });
      assert.deepEqual(combatCamera(variant), camera);
      const v = combatVisuals(variant, age)[0];
      assert.deepEqual(worldToScreen(camera, v.x, v.y), screenRoot);
    }
  }
});

test('Actual approach and retreat cross the 896px zoom boundary continuously in both directions and for either player', () => {
  const trajectories = new Map();
  for (const direction of [-1, 1]) for (const owner of [0, 1]) {
    let s = roots(direction === 1 ? 80 : 1200, direction === 1 ? 1200 : 80);
    if (owner === 1) [s.fighters[0].x, s.fighters[1].x] = [s.fighters[1].x, s.fighters[0].x];
    s = stepCombat(s, [N, N]); const frames = [];
    for (let frame = 0; frame <= 540; frame++) {
      const gap = Math.abs(s.fighters[0].x - s.fighters[1].x);
      const expected = frame <= 262 ? 1120 - frame * 4 : frame <= 277 ? 72 : frame <= 539 ? 72 + (frame - 277) * 4 : 1120;
      close(gap, expected, `actual movement distance at ${frame}`);
      const camera = checkFrame(s); frames.push(camera);
      close(camera.zoom, gap <= 896 ? 1 : 1280 / (gap + 384), 'zoom follows actual core roots');
      if ([55, 56, 57, 482, 483, 484].includes(frame)) assert.ok([892, 896, 900].includes(gap));
      if (frame === 540) break;
      const next = frame + 1, axis = next <= 262 ? direction : next <= 277 ? 0 : next <= 539 ? -direction : 0;
      s = stepCombat(s, owner === 0 ? [{ ...N, axis }, N] : [N, { ...N, axis }]);
    }
    trajectories.set(`${direction}/${owner}`, frames);
    for (let i = 1; i < frames.length; i++) {
      assert.ok(Math.abs(frames[i].zoom - frames[i - 1].zoom) < .0032, '4px world step must not jump in zoom');
      assert.ok(Math.abs(frames[i].offsetX - frames[i - 1].offsetX) < 2.35, '4px world step must not jump in pan');
    }
  }
  assert.deepEqual(trajectories.get('1/0'), trajectories.get('1/1'));
  assert.deepEqual(trajectories.get('-1/0'), trajectories.get('-1/1'));
  for (let frame = 0; frame <= 540; frame++) {
    const a = trajectories.get('1/0')[frame], b = trajectories.get('-1/0')[frame];
    close(a.zoom, b.zoom, 'mirrored movement zoom'); close(a.offsetX, -b.offsetX, 'mirrored movement pan');
  }
  // Sub-tick samples verify continuity, separately from the discrete movement bound above.
  for (const direction of [-1, 1]) for (const delta of [-1e-6, 1e-6]) {
    const moving = direction === 1 ? 304 + delta : 976 - delta, fixed = direction === 1 ? 1200 : 80;
    const c = combatCamera(roots(moving, fixed)), at = combatCamera(roots(direction === 1 ? 304 : 976, fixed));
    assert.ok(Math.abs(c.zoom - at.zoom) < 1e-8); assert.ok(Math.abs(c.offsetX - at.offsetX) < 1e-6);
  }
});

test('All eight attack rectangles and the active heavy-kick shoe use the same transformation as sprites and roots', () => {
  for (const [a, b] of [[80, 1200], [1200, 80], [80, 164], [1200, 1116], [500, 584]]) {
    for (const [key, attack] of Object.entries(H1.attacks)) {
      let s = roots(a, b); const input = { ...N, crouch: key.startsWith('crouch'), attacks: [key.split('-')[1]] };
      s = stepCombat(s, [input, N]);
      for (let tick = 0; tick < attack.startup; tick++) s = stepCombat(s, [N, N]);
      const f = s.fighters[0], v = combatVisuals(s)[0], c = checkFrame(s);
      assert.equal(f.attack.key, key); assert.equal(f.attack.age, attack.startup);
      close(v.x, f.x, 'active image remains on the actual attack root');
      const r = worldRect(attack.box, f), screenRoot = worldToScreen(c, f.x, f.y);
      const lo = worldToScreen(c, r.left, r.top), hi = worldToScreen(c, r.right, r.bottom);
      close(hi.x - lo.x, (attack.box.right - attack.box.left) * c.zoom, 'attack width');
      close(hi.y - lo.y, (attack.box.bottom - attack.box.top) * c.zoom, 'attack height');
      close(lo.x - screenRoot.x, (f.facing === 1 ? attack.box.left : -attack.box.right) * c.zoom, 'attack offset from image root');
      if (key === 'stand-hk') {
        // Approved image-space shoe corners are [416,456] x [80,128], origin (256,448).
        const shoe = [[416, 80], [456, 128]].map(([x, y]) => worldToScreen(c, v.x + (x - 256) * .625 * f.facing, v.y + (y - 448) * .625));
        close(Math.min(...shoe.map(p => p.x)), lo.x, 'shoe left coincides with real hitbox');
        close(Math.max(...shoe.map(p => p.x)), hi.x, 'shoe right coincides with real hitbox');
        close(shoe[0].y, lo.y, 'shoe top'); close(shoe[1].y, hi.y, 'shoe bottom');
      }
    }
  }
});

test('Pause and results freeze their framing; next round, tie replay and restart use fresh logical roots', () => {
  for (const tie of [false, true]) {
    let m = startMatch(createMatch()); m.combat = roots(80, 1200); if (!tie) m.combat.fighters[1].hp = 99;
    const framing = combatCamera(m.combat), visuals = combatVisuals(m.combat);
    m = pauseMatch(m, true); const paused = m;
    for (let tick = 0; tick < 20; tick++) m = stepMatch(m, [{ ...N, axis: 1, jump: true }, { ...N, axis: -1 }]);
    assert.equal(m, paused); assert.deepEqual(combatCamera(m.combat), framing); assert.deepEqual(combatVisuals(m.combat), visuals);
    m = pauseMatch(m, false); m = { ...m, remainingFrames: 1 }; m = stepMatch(m, [N, N]);
    assert.equal(m.result.reason, tie ? 'timeout-tie' : 'timeout');
    const result = m; for (let tick = 0; tick < 20; tick++) m = stepMatch(m, [{ ...N, axis: 1 }, { ...N, axis: -1 }]);
    assert.equal(m, result); assert.deepEqual(combatCamera(m.combat), framing);
    m = nextRound(m); assert.deepEqual(m.combat.fighters.map(f => f.x), [400, 880]);
    assert.equal(combatCamera(m.combat).zoom, 1); close(combatCamera(m.combat).offsetX, 0, 'reset pan');
    assert.equal(m.round, tie ? 1 : 2);
    if (!tie) {
      m.combat = roots(80, 1200); m.combat.fighters[1].hp = 99; m = { ...m, remainingFrames: 1 };
      m = stepMatch(m, [N, N]); assert.equal(m.phase, 'match-result');
      m = restartMatch(m); assert.equal(m.phase, 'ready');
      assert.deepEqual(combatCamera(m.combat), combatCamera(createCombat()));
    }
  }
});

test('Phaser adapters reproduce the pure world transform while HUD remains identity and is drawn once', () => {
  function fakeCamera() {
    return {
      originX: .5, originY: .5, zoom: 1, scrollX: 0, scrollY: 0,
      setOrigin(x, y) { this.originX = x; this.originY = y; return this; },
      setZoom(z) { this.zoom = z; return this; }, setScroll(x, y) { this.scrollX = x; this.scrollY = y; return this; },
      setRoundPixels(value) { this.roundPixels = value; return this; }, setName(value) { this.name = value; return this; },
      setBackgroundColor(value) { this.background = value; return this; }, ignore(objects) { this.ignored = objects; return this; },
    };
  }
  const main = fakeCamera(), hud = fakeCamera(), worldObjects = [{ id: 'stage' }, { id: 'fighter' }, { id: 'box' }, { id: 'label' }], hudObjects = [{ id: 'title' }, { id: 'ko' }];
  const scene = { cameras: { main, add: () => hud } };
  const cameras = configureCombatCameras(scene, worldObjects, hudObjects);
  assert.equal(cameras.world, main); assert.equal(cameras.hud, hud);
  assert.deepEqual(main.ignored, hudObjects); assert.deepEqual(hud.ignored, worldObjects);
  function project(c, x, y) {
    return { x: c.originX * 1280 + (x - c.scrollX - c.originX * 1280) * c.zoom,
      y: c.originY * 720 + (y - c.scrollY - c.originY * 720) * c.zoom };
  }
  for (const [a, b] of [[80, 1200], [80, 164], [1116, 1200], [400, 880]]) {
    const c = combatCamera(roots(a, b)); applyCombatCamera(main, c);
    assert.equal(main.roundPixels, false);
    for (const [x, y] of [[80, 600], [1200, 360], [640, 0], [400, 720]]) {
      const actual = project(main, x, y), expected = worldToScreen(c, x, y);
      close(actual.x, expected.x, 'Phaser world x'); close(actual.y, expected.y, 'Phaser world y');
      assert.deepEqual(project(hud, x, y), { x, y }, 'HUD must not inherit camera pan or zoom');
    }
  }
});
