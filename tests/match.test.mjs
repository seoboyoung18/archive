import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, startMatch, stepMatch, pauseMatch, nextRound, restartMatch, resultReady, secondsRemaining } from '../src/combat/match.ts';
import { H1 } from '../src/characters/h1.ts';
import { combatPose } from '../src/characters/h1-poses.ts';
import { COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { FixedStep } from '../src/combat/fixed-step.ts';

const tick=(s,a=N,b=N)=>stepMatch(s,[a,b]);
function timeout(s,hp=[70,40]) {
  s={...s,remainingFrames:1,combat:{...s.combat,fighters:structuredClone(s.combat.fighters)}};
  s.combat.fighters.forEach((f,i)=>f.hp=hp[i]);
  return tick(s);
}
function punchOnLastTick(s,attacker,targetHp=8) {
  s=structuredClone(s);s.remainingFrames=1;
  const [p,cpu]=s.combat.fighters;p.x=500;cpu.x=600;
  s.combat.fighters[1-attacker].hp=targetHp;
  Object.assign(s.combat.fighters[attacker],{action:'attack',attack:{key:'stand-lp',age:5,serial:1,hitTargets:[]}});
  return s;
}
function assertFreshCombat(s) {
  assert.deepEqual(s.combat,createMatch(s.combat.definitions).combat);
  assert.equal(s.remainingFrames,3600);assert.equal(s.result,null);assert.equal(s.resultAge,0);assert.equal(s.paused,false);
}

test('M01/M02: preparation waits, 3600 combat ticks expire and ceil timer boundaries agree',()=>{
  let s=createMatch();
  for(let i=0;i<4000;i++)assert.equal(tick(s,{...N,attacks:['hk']}),s);
  assert.equal(pauseMatch(s,true),s);assert.equal(s.phase,'ready');assert.equal(secondsRemaining(s),60);
  s=startMatch(s);assert.equal(startMatch(s),s);
  const expected=new Map([[3600,60],[3541,60],[3540,59],[1,1],[0,0]]);
  for(let i=0;i<=3600;i++){
    if(expected.has(s.remainingFrames))assert.equal(secondsRemaining(s),expected.get(s.remainingFrames));
    if(i<3600)s=tick(s);
  }
  assert.equal(s.combat.frame,3600);assert.deepEqual(s.result,{reason:'timeout-tie',winner:null});
  assert.deepEqual(s.wins,[0,0]);assert.equal(s.phase,'round-result');assert.equal(resultReady(s),true);
});

test('M03: timeout compares health in either direction, without a KO animation',()=>{
  for(const [hp,winner] of [[[70,40],0],[[40,70],1]]){
    const s=timeout(startMatch(createMatch()),hp);
    assert.deepEqual(s.result,{reason:'timeout',winner});assert.equal(s.wins[winner],1);
    assert.equal(s.combat.ended,false);assert.equal(resultReady(s),true);
    assert.equal(s.resultAge,0);assert.ok(s.combat.fighters.every(f=>f.action!=='ko'));
  }
});

test('M04: final tick hit changes the timeout winner before comparing health',()=>{
  for(const attacker of [0,1]){
    const s=punchOnLastTick(startMatch(createMatch()),attacker,70);s.combat.fighters[attacker].hp=65;
    const result=tick(s);
    assert.equal(result.combat.fighters[1-attacker].hp,62);
    assert.deepEqual(result.result,{reason:'timeout',winner:attacker});
  }
});

test('M05: final tick KO takes precedence over timeout; simultaneous damage produces double KO',()=>{
  for(const attacker of [0,1]){
    const s=tick(punchOnLastTick(startMatch(createMatch()),attacker));
    assert.equal(s.remainingFrames,0);assert.deepEqual(s.result,{reason:'ko',winner:attacker});
    assert.equal(s.wins[attacker],1);assert.equal(resultReady(s),false);
  }
  let s=punchOnLastTick(startMatch(createMatch()),0);s.combat.fighters[0].hp=8;
  Object.assign(s.combat.fighters[1],{action:'attack',attack:{key:'stand-lp',age:5,serial:1,hitTargets:[]}});
  s=tick(s);assert.deepEqual(s.combat.fighters.map(f=>f.hp),[0,0]);
  assert.deepEqual(s.result,{reason:'double-ko',winner:null});assert.deepEqual(s.wins,[0,0]);
});

test('M06: four tie replays keep round/wins and restore full health/time before a decisive round',()=>{
  for(const reason of ['timeout-tie','double-ko']){
    let s=startMatch(createMatch());
    for(let i=0;i<4;i++){
      if(reason==='timeout-tie')s=timeout(s,[13,13]);
      else {
        s=punchOnLastTick(s,0);s.combat.fighters[0].hp=8;
        Object.assign(s.combat.fighters[1],{action:'attack',attack:{key:'stand-lp',age:5,serial:1,hitTargets:[]}});
        s=tick(s);for(let f=0;f<18;f++)s=tick(s);
      }
      assert.equal(s.result.reason,reason);s=nextRound(s);
      assertFreshCombat(s);assert.equal(s.round,1);assert.deepEqual(s.wins,[0,0]);
    }
    s=timeout(s);assert.deepEqual(s.wins,[1,0]);s=nextRound(s);assert.equal(s.round,2);
  }
});

test('M07: either player wins 2:0 or 2:1, result keeps final round and cannot start another',()=>{
  for(const order of [[0,0],[1,1],[0,1,0],[1,0,1]]){
    let s=startMatch(createMatch());
    for(const [i,winner] of order.entries()){
      s=timeout(s,winner===0?[70,40]:[40,70]);
      assert.equal(s.round,i+1);
      if(i<order.length-1){assert.equal(s.phase,'round-result');s=nextRound(s);}
    }
    assert.equal(s.phase,'match-result');assert.equal(s.wins[order.at(-1)],2);
    assert.equal(nextRound(s),s);assert.equal(startMatch(s),s);
    const ready=restartMatch(s);assert.equal(ready.phase,'ready');assert.equal(ready.round,1);
    assert.deepEqual(ready.wins,[0,0]);assertFreshCombat(ready);assert.equal(restartMatch(ready),ready);
  }
});

test('M08/M09: results freeze combat, KO animates exactly 18 ticks and early transition is discarded',()=>{
  let s=tick(punchOnLastTick(startMatch(createMatch()),0));const combat=structuredClone(s.combat);
  for(let age=0;age<=18;age++){
    assert.equal(s.resultAge,age);assert.equal(resultReady(s),age===18);
    assert.equal(combatPose(s.combat.fighters[1],H1,s.resultAge),`ko-${Math.min(2,Math.floor(age/6))}`);
    assert.deepEqual(s.combat,combat);assert.deepEqual(s.wins,[1,0]);assert.equal(s.remainingFrames,0);
    if(age<18){assert.equal(nextRound(s),s);s=tick(s,{...N,axis:1,attacks:['hk']});}
  }
  assert.equal(tick(s),s);s=nextRound(s);assertFreshCombat(s);assert.equal(s.phase,'playing');
  let end=timeout(startMatch(createMatch()));const snapshot=structuredClone(end);
  for(let i=0;i<500;i++)end=tick(end,{...N,attacks:['hk']});
  assert.deepEqual(end,snapshot);
});

test('M09/M10: final KO restart is gated by animation, and pausing preserves and gates results',()=>{
  let s=startMatch(createMatch());s.wins=[1,0];s=tick(punchOnLastTick(s,0));
  assert.equal(s.phase,'match-result');assert.equal(restartMatch(s),s);
  s=pauseMatch(s,true);for(let i=0;i<30;i++)assert.equal(tick(s),s);
  assert.equal(resultReady(s),false);assert.equal(restartMatch(s),s);
  s=pauseMatch(s,false);for(let i=0;i<18;i++)s=tick(s);
  s=pauseMatch(s,true);assert.equal(resultReady(s),false);assert.equal(restartMatch(s),s);
  assert.equal(restartMatch(pauseMatch(s,false)).phase,'ready');
  s=timeout(startMatch(createMatch()));s=pauseMatch(s,true);assert.equal(nextRound(s),s);
  assert.equal(nextRound(pauseMatch(s,false)).phase,'playing');
});

test('M10: pausing attacks and airborne movement preserves all state and time',()=>{
  for(const input of [{...N,attacks:['hk']},{...N,jump:true,axis:1}]){
    let s=tick(startMatch(createMatch()),input);s=pauseMatch(s,true);const before=structuredClone(s);
    for(let i=0;i<120;i++)s=tick(s,{...N,axis:1,attacks:['lp']});
    assert.deepEqual(s,before);s=pauseMatch(s,false);s=tick(s);
    assert.equal(s.combat.frame,before.combat.frame+1);assert.equal(s.remainingFrames,before.remainingFrames-1);
  }
});

test('M11/M12: repeated transitions clear runtime but preserve definitions/wins; duplicate commands do nothing',()=>{
  const variant=structuredClone(H1);variant.id='test-data';
  for(let cycle=0;cycle<3;cycle++){
    let s=startMatch(createMatch([H1,variant]));
    s=tick(s,{...N,jump:true,axis:1});s=timeout(s);
    s=nextRound(s);assertFreshCombat(s);assert.equal(s.round,2);assert.deepEqual(s.wins,[1,0]);
    assert.equal(nextRound(s),s);assert.equal(restartMatch(s),s);
    s=timeout(s,[10,70]);s=nextRound(s);assertFreshCombat(s);assert.deepEqual(s.wins,[1,1]);
    s=timeout(s,[80,10]);const reset=restartMatch(s);
    assertFreshCombat(reset);assert.deepEqual(reset.wins,[0,0]);assert.equal(reset.round,1);
    assert.equal(reset.combat.definitions[1],variant);assert.equal(restartMatch(reset),reset);
  }
});

test('M13: 30/60/144Hz agree and remaining callbacks after timeout cannot advance combat',()=>{
  const results=[];
  for(const hz of [30,60,144]){
    let s=startMatch(createMatch());s.remainingFrames=60;const clock=new FixedStep();
    for(let i=0;i<hz*2;i++)clock.advance(1000/hz,()=>s=tick(s));
    results.push(s);assert.equal(s.combat.frame,60);assert.equal(s.remainingFrames,0);
  }
  assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
  let s=startMatch(createMatch());s.remainingFrames=1;
  new FixedStep().advance(1000,()=>s=tick(s));assert.equal(s.combat.frame,1);assert.equal(s.remainingFrames,0);
});

test('Match ticks and score updates never mutate the input state',()=>{
  const s=punchOnLastTick(startMatch(createMatch()),0);const before=structuredClone(s);
  tick(s);assert.deepEqual(s,before);
});
