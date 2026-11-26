import test from 'node:test';
import assert from 'node:assert/strict';
import { createFighters, stepMovement, movementPose, NEUTRAL } from '../src/combat/movement.ts';
import { FixedStep } from '../src/combat/fixed-step.ts';
import { MovementInput } from '../src/input/movement-input.ts';
const right = { ...NEUTRAL, axis: 1 }, left = { ...NEUTRAL, axis: -1 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('60 logical ticks move 240 pixels, independent fighter state and immutable input', () => {
  const initial = createFighters(); let fighters = initial;
  for (let i = 0; i < 60; i++) fighters = stepMovement(fighters, [right, NEUTRAL]);
  near(fighters[0].x, 640); near(fighters[1].x, 880); near(initial[0].x, 400);
});
test('Crouching prevents horizontal movement; releasing crouch resumes movement', () => {
  let fighters = stepMovement(createFighters(), [{ ...right, crouch: true }, NEUTRAL]);
  assert.equal(fighters[0].state, 'crouch'); near(fighters[0].x, 400);
  fighters = stepMovement(fighters, [right, NEUTRAL]); near(fighters[0].x, 404);
});
test('Jump reaches 160 pixels at 0.4s and lands at 0.8s', () => {
  let fighters = stepMovement(createFighters(), [{ ...NEUTRAL, jump: true }, NEUTRAL]);
  for (let i = 1; i < 24; i++) fighters = stepMovement(fighters, [NEUTRAL, NEUTRAL]);
  near(fighters[0].y, 440); near(fighters[0].vy, 0); assert.equal(movementPose(fighters[0]), 'jump-apex');
  for (let i = 24; i < 48; i++) fighters = stepMovement(fighters, [NEUTRAL, NEUTRAL]);
  near(fighters[0].y, 600); near(fighters[0].vy, 0); assert.equal(fighters[0].grounded, true);
});
test('Airborne jump is ignored, horizontal control allowed, landing uses current crouch', () => {
  let fighters = stepMovement(createFighters(), [{ ...right, jump: true }, NEUTRAL]);
  const before = fighters[0].vy;
  fighters = stepMovement(fighters, [{ ...right, jump: true }, NEUTRAL]);
  assert.ok(fighters[0].vy > before); near(fighters[0].x, 408);
  for (let i = 2; i < 48; i++) fighters = stepMovement(fighters, [{ ...NEUTRAL, crouch: true }, NEUTRAL]);
  assert.equal(fighters[0].state, 'crouch'); near(fighters[0].y, 600);
});
test('Simultaneous grounded approach splits overlap and preserves ordering and minimum gap', () => {
  let fighters = createFighters(); fighters[0].x = 500; fighters[1].x = 574;
  fighters = stepMovement(fighters, [right, left]); near(fighters[0].x, 501); near(fighters[1].x, 573);
  for (let i = 0; i < 120; i++) {
    fighters = stepMovement(fighters, [right, left]);
    near(fighters[1].x - fighters[0].x, 72);
  }
});
test('Corner correction transfers blocked separation to the other fighter on either side', () => {
  let fighters = createFighters(); fighters[0].x = 1128; fighters[1].x = 1200;
  fighters = stepMovement(fighters, [right, right]); near(fighters[0].x, 1128); near(fighters[1].x, 1200);
  fighters[0].x = 80; fighters[1].x = 152;
  fighters = stepMovement(fighters, [left, left]); near(fighters[0].x, 80); near(fighters[1].x, 152);
});
test('Facing is relative to opponent; airborne facing is locked', () => {
  const fighters = createFighters(); fighters[0].x = 880; fighters[1].x = 400;
  let next = stepMovement(fighters, [NEUTRAL, NEUTRAL]); assert.equal(next[0].facing, -1);
  next[0].grounded = false; next[0].y = 500; next[0].facing = 1;
  next = stepMovement(next, [NEUTRAL, NEUTRAL]); assert.equal(next[0].facing, 1);
  assert.ok(next[0].x - next[1].x >= 72);
});
test('Animation follows logical age and vertical speed boundaries', () => {
  const [fighter] = createFighters();
  for (const [age, pose] of [[0,'idle-0'],[14,'idle-0'],[15,'idle-1'],[29,'idle-1'],[30,'idle-0']]) assert.equal(movementPose({...fighter,age}),pose);
  for (const [age, pose] of [[0,'walk-0'],[5,'walk-0'],[6,'walk-1'],[12,'walk-2'],[18,'walk-3'],[24,'walk-0']]) assert.equal(movementPose({...fighter,state:'walk',age}),pose);
  for (const [vy,pose] of [[-101,'jump-rise'],[-100,'jump-apex'],[100,'jump-apex'],[101,'jump-fall']]) assert.equal(movementPose({...fighter,state:'jump',vy}),pose);
});
test('Fixed step gives the same result at 30/60/144 render Hz', () => {
  const results = [];
  for (const hz of [30,60,144]) {
    let fighters = createFighters(); const clock = new FixedStep();
    for (let i = 0; i < hz; i++) clock.advance(1000/hz, () => { fighters = stepMovement(fighters,[right,NEUTRAL]); });
    results.push(fighters);
  }
  assert.deepEqual(results[0],results[1]); assert.deepEqual(results[1],results[2]);
});
test('Overload processes at most 5 ticks; reset discards partial time', () => {
  const clock = new FixedStep(); let ticks = 0;
  assert.equal(clock.advance(5000,()=>ticks++),5); assert.equal(clock.advance(0,()=>ticks++),0);
  clock.advance(8,()=>ticks++); clock.reset(); clock.advance(9,()=>ticks++); assert.equal(ticks,5);
});
test('Opposite directions neutralize; OS repetition does not retrigger jump', () => {
  const input = new MovementInput();
  input.keyDown('KeyA'); input.keyDown('KeyD'); input.keyDown('KeyW'); input.keyDown('KeyS');
  assert.deepEqual(input.sample(),NEUTRAL);
  input.keyUp('KeyW'); assert.equal(input.sample().crouch,true);
  input.keyUp('KeyS'); input.keyDown('KeyW'); assert.equal(input.sample().jump,true);
  input.keyDown('KeyW',true); assert.equal(input.sample().jump,false);
});
test('Held W never jumps again after landing; airborne pulse is not buffered', () => {
  const input = new MovementInput(); input.keyDown('KeyW'); let fighters = createFighters();
  for (let i=0;i<120;i++) {
    if(i===10) { input.keyUp('KeyW'); input.keyDown('KeyW'); }
    fighters=stepMovement(fighters,[input.sample(),NEUTRAL]);
  }
  near(fighters[0].y,600); assert.equal(fighters[0].grounded,true);
});
test('Reset and inactive keys require release before reuse; samples consume pulses', () => {
  const input = new MovementInput(); input.keyDown('KeyD'); input.keyDown('KeyW'); input.reset();
  assert.deepEqual(input.sample(),NEUTRAL); input.keyDown('KeyD'); assert.equal(input.sample().axis,0);
  input.keyUp('KeyD'); input.keyDown('KeyD'); assert.equal(input.sample().axis,1);
  input.keyDown('KeyA',false,false); input.keyDown('KeyA'); assert.equal(input.sample().axis,1);
  input.keyUp('KeyA'); input.keyDown('KeyA'); assert.equal(input.sample().axis,0);
});
