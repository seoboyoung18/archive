import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCombat, stepCombat, clearGrabs, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { H1 } from '../src/characters/h1.ts';
import { combatPose } from '../src/characters/h1-poses.ts';
import { combatVisual } from '../src/characters/h1-visual.ts';

const chord = { ...N, attacks: ['lp','hp'], handEvents: [
  {slot:'lp',down:true},{slot:'hp',down:true},{slot:'hp',down:false},{slot:'lp',down:false},
] };
function scene(dir, corner) {
  let s = createCombat();
  const a = corner === 'left' ? (dir === 1 ? 80 : 164)
    : corner === 'right' ? (dir === 1 ? 1116 : 1200) : 640 - dir * 42;
  s.fighters[0].x = a; s.fighters[1].x = a + dir * 84;
  s = stepCombat(s,[chord,N]);
  for(let i=0;i<6;i++) s=stepCombat(s,[N,N]);
  return s;
}

test('Throw display transforms preserve simulation and freeze exactly at every end snapshot',()=>{
  for(const dir of [1,-1]) {
    let s=scene(dir,'center');
    for(let age=0;age<=72;age++) {
      const before=structuredClone(s), cleared=clearGrabs(s);
      for(let i=0;i<2;i++) {
        assert.deepEqual(combatVisual(cleared.fighters[i],H1),combatVisual(s.fighters[i],H1));
        for(const n of Object.values(combatVisual(s.fighters[i],H1))) assert.ok(Number.isFinite(n));
      }
      assert.deepEqual(s,before,'render inspection must never change gameplay roots or facing');
      s=stepCombat(s,[N,N]);
    }
    for(const f of s.fighters) {
      const v=combatVisual(f,H1);
      assert.equal(v.angle,0);assert.equal(v.originY,0.875);assert.equal(v.x,f.x);assert.equal(v.y,f.y);
    }
  }
});

test('Mirrored throw arcs are symmetric before hitting arena limits',()=>{
  let right=scene(1,'center'),left=scene(-1,'center');
  for(let age=0;age<=72;age++) {
    for(let i=0;i<2;i++) {
      const a=combatVisual(right.fighters[i],H1),b=combatVisual(left.fighters[i],H1);
      assert.ok(Math.abs(a.x+b.x-1280)<1e-8);assert.equal(a.y,b.y);assert.ok(Math.abs(a.angle+b.angle)<1e-8);
    }
    right=stepCombat(right,[N,N]);left=stepCombat(left,[N,N]);
  }
});

test('Adopted airborne and grounded throw artwork stays inside both horizontal stage edges',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../assets/characters/h1/derived/throw-v1/manifest.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
  const bounds=Object.fromEntries(manifest.frames.map(f=>[f.id,f.outputBounds]));
  for(const corner of ['left','right'])for(const dir of [-1,1]) {
    let s=scene(dir,corner);
    for(let age=0;age<60;age++) {
      const f=s.fighters[1],pose=combatPose(f,H1),v=combatVisual(f,H1),b=bounds[pose];
      if(b)for(const x of [b.left,b.right])for(const y of [b.top,b.bottom]) {
        const dx=(x-256)*0.625*f.facing,dy=(y-512*v.originY)*0.625,r=v.angle*Math.PI/180;
        const worldX=v.x+dx*Math.cos(r)-dy*Math.sin(r);
        assert.ok(worldX>=0 && worldX<=1280,`${corner} dir${dir} H${age} ${pose} clips at ${worldX}`);
      }
      s=stepCombat(s,[N,N]);
    }
  }
});

test('Airborne display uses the throw owner distance even when the victim has no grab definition',()=>{
  const attacker={...H1,grab:{...H1.grab,push:20}},victim={...H1,grab:undefined};
  let s=createCombat([attacker,victim]);s.fighters[0].x=500;s.fighters[1].x=584;
  s=stepCombat(s,[chord,N]);for(let i=0;i<6;i++)s=stepCombat(s,[N,N]);
  for(let age=0;age<=36;age++) {
    const f=s.fighters[1],v=combatVisual(f,victim);
    assert.equal(f.grab.pushDistance,20);
    assert.ok(v.x<=604,'the airborne drawing cannot anticipate the victim default 48px push');
    assert.ok(combatPose(f,victim));
    if(age===36){assert.equal(f.x,604);assert.equal(v.x,604);assert.equal(f.hp,82)}
    s=stepCombat(s,[N,N]);
  }
  const fast={...H1,grab:{...H1.grab,impact:13,attackerRecovery:20,targetRecovery:25}};
  s=createCombat([fast,victim]);s.fighters[0].x=500;s.fighters[1].x=584;
  s=stepCombat(s,[chord,N]);for(let i=0;i<19;i++)s=stepCombat(s,[N,N]);
  assert.equal(s.fighters[1].hp,82);
  assert.equal(combatPose(s.fighters[1],victim),'thrown-down','even the earliest valid impact must show its ground contact');
  assert.equal(combatPose(s.fighters[0],fast),'throw-slam');
});
