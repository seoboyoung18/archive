import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { H1 } from '../src/characters/h1.ts';
import { H1_POSES, H1_PREVIOUS_HEAVY_POSES, combatPose } from '../src/characters/h1-poses.ts';
import { createCombat, stepCombat, attackPhase, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';

test('All 75 distinct pose keys resolve to 75 existing sprite files without fallback', () => {
  assert.equal(Object.keys(H1_POSES).length,75);
  assert.equal(new Set(Object.values(H1_POSES)).size,75);
  for(const path of Object.values(H1_POSES)) assert.ok(existsSync(new URL(`../assets/characters/h1/derived/${path}`,import.meta.url)),path);
  assert.equal(Object.keys(H1_PREVIOUS_HEAVY_POSES).length,26);
  for(const [pose,path] of Object.entries(H1_POSES)) {
    assert.equal(path.startsWith('opposite-limbs-v1/'), /^(stand|crouch)-h[pk]-/.test(pose), pose);
  }
  for(const path of Object.values(H1_PREVIOUS_HEAVY_POSES)) assert.ok(existsSync(new URL(`../assets/characters/h1/derived/${path}`,import.meta.url)),path);
});
test('Every attack uses the combat age for startup/active/recovery and exits at its total length', () => {
  // Independent fixture transcribed from h1-all-attack-frames.md, not the pose implementation.
  const fixture = {
    'stand-lp': [['stand-lp-startup',3],['lp-extend',3],['stand-lp-active',3],['lp-retract',5],['stand-lp-recovery',5],['lp-settle',5]],
    'stand-hp': [['startup',5],['extend',5],['active',3],['retract',7],['recovery',7],['settle',7]],
    'stand-lk': [['startup',4],['extend',4],['active',4],['retract',6],['recovery',6],['settle',6]],
    'stand-hk': [['startup',6],['lift',6],['apex',4],['descend',8],['active',7],['retract',7],['recovery',7],['settle',7]],
    'crouch-lp': [['startup',3],['extend',3],['active',3],['retract',5],['recovery',5],['settle',5]],
    'crouch-hp': [['startup',5],['extend',5],['active',3],['retract',7],['recovery',7],['settle',7]],
    'crouch-lk': [['startup',4],['extend',4],['active',4],['retract',6],['settle',6],['recovery',6]],
    'crouch-hk': [['startup',7],['extend',7],['active',4],['retract',8],['settle',8],['recovery',8]],
  };
  for(const [key,a] of Object.entries(H1.attacks)) {
    const expected=fixture[key].flatMap(([pose,duration])=>Array(duration).fill(key==='stand-lp'?pose:`${key}-${pose}`));
    assert.equal(expected.length,a.startup+a.active+a.recovery);
    let s=createCombat();
    s=stepCombat(s,[{...N,crouch:key.startsWith('crouch'),attacks:[key.split('-')[1]]},N]);
    for(let age=0;age<a.startup+a.active+a.recovery;age++) {
      const phase=age<a.startup?'startup':age<a.startup+a.active?'active':'recovery';
      assert.equal(combatPose(s.fighters[0],H1),expected[age]);
      assert.equal(combatPose({...s.fighters[0],facing:-1},H1),expected[age]);
      assert.equal(attackPhase(s.fighters[0],H1),phase);
      s=stepCombat(s,[N,N]);
    }
    assert.match(combatPose(s.fighters[0],H1),/^idle-/);
  }
});
test('Standing heavy kick contacts on the first extension and never during descent, on either side', () => {
  for (const facing of [1,-1]) {
    let s=createCombat();
    s.fighters[0].x=facing===1?500:600; s.fighters[1].x=facing===1?600:500;
    s=stepCombat(s,[{...N,attacks:['hk']},N]);
    for(let age=0;age<52;age++) {
      assert.equal(s.fighters[0].attack.age,age);
      assert.equal(s.fighters[1].hp,age<12?100:84,`age ${age}, facing ${facing}`);
      assert.equal(s.events.length,age===12?1:0);
      if(age>=12&&age<=15) {
        assert.equal(attackPhase(s.fighters[0],H1),'active');
        assert.equal(combatPose(s.fighters[0],H1),'stand-hk-apex');
      }
      if(age===16||age===24) assert.equal(attackPhase(s.fighters[0],H1),'recovery');
      s=stepCombat(s,[N,N]);
    }
    assert.equal(s.fighters[0].attack,null);
    assert.match(combatPose(s.fighters[0],H1),/^idle-/);
  }
});

test('Missing the first heavy kick cannot hit an opponent entering during descent', () => {
  for(const facing of [1,-1]) for(const enterAge of [16,24]) {
    let s=createCombat();
    s.fighters[0].x=facing===1?500:800; s.fighters[1].x=facing===1?800:500;
    s=stepCombat(s,[{...N,attacks:['hk']},N]);
    for(let age=1;age<52;age++) {
      if(age===enterAge) s.fighters[1].x=s.fighters[0].x+facing*100;
      s=stepCombat(s,[N,N]);
      assert.equal(s.events.length,0,`late entry ${enterAge}, age ${age}`);
      assert.equal(s.fighters[1].hp,100);
    }
  }
});

test('Walking presents twelve successive poses for four frames each and repeats every 48 frames', () => {
  const poses=['walk-00','walk-01','walk-02','walk-03','walk-04','walk-05','walk-06','walk-07','walk-08','walk-09','walk-10','walk-11'];
  const f=createCombat().fighters[0];
  for(let cycle=0;cycle<3;cycle++) for(let segment=0;segment<12;segment++) for(let offset=0;offset<4;offset++) {
    assert.equal(combatPose({...f,state:'walk',age:cycle*48+segment*4+offset},H1),poses[segment]);
  }
});
test('Forward/backward walking follows travel relative to facing on both sides without changing speed', () => {
  for(const facing of [-1,1]) for(const axis of [-1,1]) {
    let s=createCombat();
    s.fighters[0].x=facing===1?400:880; s.fighters[1].x=facing===1?880:400;
    const start=s.fighters[0].x;
    for(let tick=0;tick<9;tick++)s=stepCombat(s,[{...N,axis},N]);
    const f=s.fighters[0];
    assert.equal(f.walkDirection,axis); assert.equal(f.x,start+axis*36);
    assert.equal(combatPose(f,H1),facing===axis?'walk-02':'walk-10');
    s=stepCombat(s,[N,N]); assert.match(combatPose(s.fighters[0],H1),/^idle-/);
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
