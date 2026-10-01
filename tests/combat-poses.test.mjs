import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { H1 } from '../src/characters/h1.ts';
import { H1_POSES, combatPose } from '../src/characters/h1-poses.ts';
import { createCombat, stepCombat, attackPhase, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';

test('All 48 distinct pose keys resolve to 48 existing sprite files without fallback', () => {
  assert.equal(Object.keys(H1_POSES).length,48);
  assert.equal(new Set(Object.values(H1_POSES)).size,48);
  for(const path of Object.values(H1_POSES)) assert.ok(existsSync(new URL(`../assets/characters/h1/derived/${path}`,import.meta.url)),path);
});
test('Every attack uses the combat age for startup/active/recovery and exits at its total length', () => {
  for(const [key,a] of Object.entries(H1.attacks)) {
    let s=createCombat();
    s=stepCombat(s,[{...N,crouch:key.startsWith('crouch'),attacks:[key.split('-')[1]]},N]);
    for(let age=0;age<a.startup+a.active+a.recovery;age++) {
      const phase=age<a.startup?'startup':age<a.startup+a.active?'active':'recovery';
      const lp = ['stand-lp-startup','lp-extend','stand-lp-active','lp-retract','stand-lp-recovery','lp-settle'];
      const segment = age < 3 ? 0 : age < 6 ? 1 : age < 9 ? 2 : age < 14 ? 3 : age < 19 ? 4 : 5;
      assert.equal(combatPose(s.fighters[0],H1),key === 'stand-lp' ? lp[segment] : `${key}-${phase}`);
      assert.equal(attackPhase(s.fighters[0],H1),phase);
      s=stepCombat(s,[N,N]);
    }
    assert.match(combatPose(s.fighters[0],H1),/^idle-/);
  }
});
test('Walking presents eight successive poses for three frames each and repeats every 24 frames', () => {
  const poses=['walk-0','walk-mid-0','walk-1','walk-mid-1','walk-2','walk-mid-2','walk-3','walk-mid-3'];
  const f=createCombat().fighters[0];
  for(let cycle=0;cycle<3;cycle++) for(let segment=0;segment<8;segment++) for(let offset=0;offset<3;offset++) {
    assert.equal(combatPose({...f,state:'walk',age:cycle*24+segment*3+offset},H1),poses[segment]);
  }
});
test('Hit and guard use locked/current posture even if the movement state is stale', () => {
  const f=createCombat().fighters[0];
  for(const action of ['hit','guard']) for(const posture of ['stand','crouch']) {
    assert.equal(combatPose({...f,action,posture,state:'walk'},H1),`${posture}-${action}`);
  }
});
test('KO takes precedence: 0..5 / 6..11 / 12..17 then final pose holds; winner pose stays frozen', () => {
  const f=createCombat().fighters[0];
  const ko={...f,action:'ko',attack:{key:'stand-lp',age:6,serial:1,hitTargets:[]}};
  for(const [frame,expected] of [[0,0],[5,0],[6,1],[11,1],[12,2],[17,2],[18,2],[999,2]]) assert.equal(combatPose(ko,H1,frame),`ko-${expected}`);
  const winner={...f,state:'walk',age:7};
  assert.equal(combatPose(winner,H1,0),combatPose(winner,H1,18));
});
test('Missing attack phase cannot silently render an idle placeholder', () => {
  const f=createCombat().fighters[0];
  assert.throws(()=>combatPose({...f,action:'attack',attack:{key:'stand-lp',age:24,serial:1,hitTargets:[]}},H1),/outside/);
});
