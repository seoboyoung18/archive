import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchInputBuffer } from '../src/input/match-input.ts';
import { COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';

test('M12: a held shortcut cannot cross result/resume boundaries or repeat a button key',()=>{
  const input=new MatchInputBuffer();
  for(const code of ['Enter','Escape','KeyR']) {
    assert.equal(input.keyDown(code,false,true,false),code);input.reset();
    assert.equal(input.keyDown(code,true,true,false),null);
    assert.equal(input.keyDown(code,false,true,false),null);
    input.keyUp(code);assert.equal(input.keyDown(code,false,true,false),code);input.keyUp(code);
    assert.equal(input.keyDown(code,false,false,false),null);input.reset();
    assert.equal(input.keyDown(code,false,true,false),null);input.keyUp(code);
  }
});
test('M11/M12: transition clears queued attacks/movement; inactive and held keys must release',()=>{
  const input=new MatchInputBuffer();
  for(const code of ['KeyD','KeyK','KeyW'])input.keyDown(code,false,true,true);
  input.reset();assert.deepEqual(input.sample(),{...N,handEvents:[]});
  for(const code of ['KeyD','KeyK','KeyW'])input.keyDown(code,false,true,true);
  assert.deepEqual(input.sample(),{...N,handEvents:[]});
  for(const code of ['KeyD','KeyK','KeyW'])input.keyUp(code);
  input.keyDown('KeyU',false,true,false);input.reset();input.keyDown('KeyU',false,true,true);
  assert.deepEqual(input.sample(),{...N,handEvents:[]});input.keyUp('KeyU');input.keyDown('KeyU',false,true,true);
  assert.deepEqual(input.sample().attacks,['lp']);
  input.reset();input.keyDown('KeyI',false,false,true);assert.deepEqual(input.sample(),{...N,handEvents:[]});
});
