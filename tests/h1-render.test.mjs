import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedStep } from '../src/combat/fixed-step.ts';
import { createCombat, stepCombat, COMBAT_NEUTRAL as N, worldRect } from '../src/combat/combat.ts';
import { createMatch, startMatch, stepMatch } from '../src/combat/match.ts';
import { combatVisuals } from '../src/characters/h1-visual.ts';
import { combatPose, H1_ATTACK_FRAMES } from '../src/characters/h1-poses.ts';
import { combatCamera, worldToScreen } from '../src/characters/h1-camera.ts';
import { sampleCombatRender } from '../src/characters/h1-render.ts';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const chord = { ...N, attacks: ['lp', 'hp'], handEvents: [
  { slot: 'lp', down: true }, { slot: 'hp', down: true }, { slot: 'hp', down: false }, { slot: 'lp', down: false },
] };
const freeze = x => { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
function exact(previous, current, alpha = .5, koFrame = 0) {
  const rendered = sampleCombatRender(previous, current, alpha, koFrame);
  assert.deepEqual(rendered.fighters, current.fighters);
  assert.deepEqual(rendered.visuals, combatVisuals(current, koFrame));
  assert.deepEqual(rendered.camera, combatCamera(current));
  return rendered;
}

test('FixedStep exposes the remaining tick fraction without changing catch-up or reset', () => {
  const clock = new FixedStep(); let count = 0;
  assert.equal(clock.alpha, 0);
  assert.equal(clock.advance(1000 / 120, () => count++), 0); near(clock.alpha, .5);
  assert.equal(clock.advance(1000 / 120, () => count++), 1); near(clock.alpha, 0);
  assert.equal(clock.advance(1000, () => count++), 5); assert.equal(count, 6); near(clock.alpha, 0);
  clock.advance(5, () => count++); assert.ok(clock.alpha > 0); clock.reset(); assert.equal(clock.alpha, 0);
});

test('continuous movement shares one sample for both roots, artwork, guides and camera', () => {
  let previous = createCombat(); previous.fighters[0].x = 80; previous.fighters[1].x = 1200;
  previous = stepCombat(previous, [{ ...N, axis: 1 }, N]);
  const current = stepCombat(previous, [{ ...N, axis: 1 }, N]);
  freeze(previous); freeze(current); const before = JSON.stringify([previous, current]);
  const rendered = sampleCombatRender(previous, current, .5);
  near(rendered.fighters[0].x, 86); near(rendered.fighters[1].x, 1200);
  near(rendered.visuals[0].x, 86); near(rendered.visuals[1].x, 1200);
  assert.deepEqual(rendered.camera, combatCamera({ fighters: rendered.fighters }));
  const hurt = worldRect(current.definitions[0].hurt.stand, rendered.fighters[0]);
  const root = worldToScreen(rendered.camera, rendered.fighters[0].x, 600);
  const edge = worldToScreen(rendered.camera, hurt.left, hurt.bottom);
  near(root.x - edge.x, 36 * rendered.camera.zoom); near(root.y, edge.y);
  assert.deepEqual(rendered.poses, current.fighters.map((f, i) => combatPose(f, current.definitions[i])));
  assert.equal(JSON.stringify([previous, current]), before);
});

test('120Hz rendering fills continuous movement intervals while core events and state stay identical', () => {
  const run = renderHz => {
    const clock = new FixedStep(); let state = createCombat(), previous = null; const output = [];
    for (let frame = 0; frame < renderHz; frame++) {
      clock.advance(1000 / renderHz, () => { previous = state; state = stepCombat(state, [{ ...N, axis: 1 }, N]); });
      output.push(sampleCombatRender(previous, state, clock.alpha).fighters[0].x);
    }
    return { state, output };
  };
  const normal = run(60), fast = run(120); assert.deepEqual(fast.state, normal.state);
  for (let i = 4; i < fast.output.length; i++) near(fast.output[i] - fast.output[i - 1], 2);
});

test('attack artwork uses the current active age even at interpolation alpha zero', () => {
  let state = createCombat(); state = stepCombat(state, [{ ...N, attacks: ['hk'] }, N]);
  while (state.fighters[0].attack.age < 11) state = stepCombat(state, [N, N]);
  const current = stepCombat(state, [N, N]);
  const rendered = sampleCombatRender(state, current, 0);
  assert.equal(current.fighters[0].attack.age, 12);
  assert.ok(H1_ATTACK_FRAMES['stand-hk'].active.includes(rendered.poses[0]));
  const box = worldRect(current.definitions[0].attacks['stand-hk'].box, rendered.fighters[0]);
  near(box.left - rendered.visuals[0].x, 100); near(box.right - rendered.visuals[0].x, 125);
  assert.equal(rendered.fighters[0].attack.age, 12);
});

test('actual hit/push and KO immediately show the current frame rather than a blended displacement', () => {
  for (const hp of [100, 16]) {
    let state = createCombat(); state.fighters[0].x = 500; state.fighters[1].x = 660; state.fighters[1].hp = hp;
    state = stepCombat(state, [{ ...N, attacks: ['hk'] }, N]);
    let previous;
    do { previous = state; state = stepCombat(state, [N, N]); } while (!state.events.length);
    assert.equal(state.events[0].damage, 16); assert.equal(state.fighters[1].x, 708);
    exact(previous, state, .1); if (hp === 16) assert.equal(state.ended, true);
  }
});

test('takeoff, landing, facing changes and discarded history snap; airborne rotation is linear when continuous', () => {
  let state = createCombat(), previous = state;
  state = stepCombat(state, [{ ...N, jump: true }, N]); exact(previous, state);
  previous = state; state = stepCombat(state, [N, N]);
  const before = combatVisuals(previous), after = combatVisuals(state), rendered = sampleCombatRender(previous, state, .5);
  near(rendered.visuals[0].y, (before[0].y + after[0].y) / 2);
  near(rendered.visuals[0].angle, (before[0].angle + after[0].angle) / 2);
  while (!state.fighters[0].grounded) { previous = state; state = stepCombat(state, [N, N]); }
  exact(previous, state); exact(null, state, 0);
  const reversed = { ...state, frame: state.frame + 1, fighters: [{ ...state.fighters[0], facing: -state.fighters[0].facing }, state.fighters[1]] };
  exact(state, reversed);
});

test('grab relation changes, impact and pose-origin switches snap both participants', () => {
  let state = createCombat(); state.fighters[0].x = 500; state.fighters[1].x = 584;
  state = stepCombat(state, [chord, N]); let captures = 0, impacts = 0, originSwitches = 0;
  for (let i = 0; i < 78; i++) {
    const previous = state; state = stepCombat(state, [N, N]);
    const before = combatVisuals(previous), after = combatVisuals(state);
    if (state.grabEvents.length) { exact(previous, state, .25); captures += state.grabEvents.some(e => e.kind === 'hold'); impacts += state.grabEvents.some(e => e.kind === 'impact'); }
    if (before.some((v, j) => v.originY !== after[j].originY)) { exact(previous, state, .25); originSwitches++; }
  }
  assert.equal(captures, 1); assert.equal(impacts, 1); assert.ok(originSwitches >= 2);
});

test('timeout/pause/reset callers can discard history without replaying an old transform', () => {
  let match = startMatch({ ...createMatch(), remainingFrames: 1 }); const previous = match.combat;
  match = stepMatch(match, [{ ...N, axis: 1 }, N]); assert.equal(match.phase, 'round-result');
  exact(null, match.combat, 0); exact(null, match.combat, .8);
  exact(previous, createCombat(), .5); // New frame zero is not the previous timeline.
});
