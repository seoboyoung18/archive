import test from 'node:test';
import assert from 'node:assert/strict';
import { createH1Ai, stepH1Ai, H1_AI_ORDER } from '../src/combat/h1-ai.ts';
import { observeH1Ai, stepH1AiMatch, transitionH1Ai } from '../src/combat/h1-ai-match.ts';
import { createCombat, stepCombat, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createMatch, startMatch, pauseMatch, nextRound, restartMatch, resultReady } from '../src/combat/match.ts';
import { FixedStep } from '../src/combat/fixed-step.ts';
import { H1 } from '../src/characters/h1.ts';

function fixture(d=100,side=1) {
  const c=createCombat();c.fighters[0].x=500;c.fighters[1].x=500+d;
  return {c,view:()=>observeH1Ai(c,side),self:c.fighters[side],other:c.fighters[1-side]};
}
const choose=(f,cursor=0)=>stepH1Ai({...createH1Ai(),cursor},f.view);
const attackKey=input=>input.attacks.length?`${input.crouch?'crouch':'stand'}-${input.attacks[0]}`:null;
const transition=(s,next)=>({match:next,ai:transitionH1Ai(s.ai,s.match,next)});
const tick=(s,input=N)=>stepH1AiMatch(s.match,s.ai,input);
const playing=()=>({match:startMatch(createMatch()),ai:createH1Ai()});
function untilResult(s,input=()=>N) {
  while(s.match.phase==='playing')s=tick(s,input(s));
  while(!resultReady(s.match))s=tick(s);
  return s;
}

test('A01: observes exactly 0/12/24, keeps directions and emits a single attack pulse',()=>{
  const f=fixture(400);let ai=createH1Ai(),seen=[];
  for(let frame=0;frame<25;frame++) {
    if(frame===1)f.other.x=f.self.x-100;
    const r=stepH1Ai(ai,()=>{seen.push(frame);return f.view();});ai=r.ai;
    if(frame<12){assert.equal(r.input.axis,-1);assert.deepEqual(r.input.attacks,[]);}
    if(frame===12)assert.equal(attackKey(r.input),'stand-lp');
    if(frame>12&&frame<24)assert.deepEqual(r.input.attacks,[]);
    assert.equal(r.input.jump,false);
  }
  assert.deepEqual(seen,[0,12,24]);
});

test('A02: observation omits private state; current PLAYER input cannot change the CPU choice',()=>{
  const s=playing();s.match.combat.fighters[0].x=500;s.match.combat.fighters[1].x=600;
  const view=observeH1Ai(s.match.combat,1),before=structuredClone(s);
  for(const f of [view.self,view.opponent]) {
    for(const key of ['hp','stun','nextAttackId','vy','age','inputs'])assert.equal(key in f,false);
  }
  const first=tick(s),second=tick(s,{...N,attacks:['hk'],crouch:true});
  assert.deepEqual(first.ai,second.ai);
  assert.equal(first.match.combat.fighters[1].attack.key,second.match.combat.fighters[1].attack.key);
  assert.deepEqual(s,before);
});

test('A03: every candidate is selectable, advances after its own index, wraps and skips invalid choices',()=>{
  for(const side of [0,1])for(let cursor=0;cursor<8;cursor++) {
    const r=choose(fixture(100,side),cursor);
    assert.equal(attackKey(r.input),H1_AI_ORDER[cursor]);assert.equal(r.ai.cursor,(cursor+1)%8);
  }
  let f=fixture(150);assert.equal(attackKey(choose(f,3).input),'stand-hk');
  f.other.posture='crouch';assert.equal(attackKey(choose(f,3).input),'crouch-lk');
  f=fixture(180);const r=choose(f,3);assert.equal(attackKey(r.input),null);assert.equal(r.ai.cursor,3);
});

test('A04/A05: approved distance limits are inclusive, mirrored and separate from real contact',()=>{
  const limits=[132,152,162,153,124,140,152,172];
  for(const side of [0,1])for(const [index,d] of limits.entries()) {
    assert.equal(attackKey(choose(fixture(d,side),index).input),H1_AI_ORDER[index]);
    assert.notEqual(attackKey(choose(fixture(d+1,side),index).input),H1_AI_ORDER[index]);
  }
  for(const d of [153,154,160,161])for(const side of [0,1]) {
    const f=fixture(d,side);
    assert.equal(attackKey(choose(f,3).input)==='stand-hk',d===153);
    f.other.posture='crouch';assert.notEqual(attackKey(choose(f,3).input),'stand-hk');
  }
  const f=fixture(100);f.other.y=200;assert.equal(choose(f).input.attacks.length,0);
});

test('A06: standing guard/back-walk selects low kicks, with no hidden held-key inference',()=>{
  for(const side of [0,1])for(const condition of ['guard','back-walk'])for(const [d,key] of [[152,'crouch-lk'],[153,'crouch-hk'],[172,'crouch-hk'],[173,null]]) {
    const f=fixture(d,side);
    if(condition==='guard')f.other.action='guard';
    else {f.other.state='walk';f.other.walkDirection=side===0?1:-1;}
    const r=choose(f,3);assert.equal(attackKey(r.input),key);
    assert.equal(r.ai.cursor,key==='crouch-lk'?7:key==='crouch-hk'?0:3);
  }
  const f=fixture(100);f.other.state='idle';f.other.walkDirection=-1;
  assert.equal(attackKey(choose(f).input),'stand-lp');
  f.other.action='guard';f.other.posture='crouch';assert.equal(attackKey(choose(f).input),'stand-lp');
});

test('A07: visible startup/active threats choose the correct guard; recovery and misses do not',()=>{
  for(const side of [0,1])for(const key of ['stand-lp','stand-hk','crouch-lk'])for(const phase of ['startup','active','recovery']) {
    const f=fixture(120,side),a=H1.attacks[key];
    f.other.action='attack';f.other.posture=key.startsWith('crouch')?'crouch':'stand';
    f.other.attack={key,age:phase==='startup'?0:phase==='active'?a.startup:a.startup+a.active,serial:1,hitTargets:[]};
    const r=choose(f);
    if(phase!=='recovery') {
      assert.equal(r.input.axis,side===0?-1:1);assert.equal(r.input.crouch,a.height==='low');
      assert.deepEqual(r.input.attacks,[]);assert.equal(r.ai.cursor,0);
    } else assert.equal(attackKey(r.input),'stand-lp');
  }
  let f=fixture(120);f.other.action='attack';f.other.attack={key:'stand-hk',age:12,serial:1,hitTargets:[]};
  f.self.posture='crouch';assert.equal(attackKey(choose(f).input),'stand-lp');
  f.self.posture='stand';f.other.facing=-1;assert.equal(attackKey(choose(f).input),'stand-lp');
  f=fixture(200);f.other.action='attack';f.other.attack={key:'stand-lp',age:0,serial:1,hitTargets:[]};
  assert.equal(choose(f).input.axis,-1);
});

test('A08: locked actions never cancel or queue attacks, guard stun maintains back/posture',()=>{
  for(const action of ['attack','hit','ko']) {
    const f=fixture();f.self.action=action;f.self.posture='crouch';let r=choose(f,5);
    assert.deepEqual(r.input,{...N,crouch:true});assert.equal(r.ai.cursor,5);
    f.self.action='free';for(let i=0;i<11;i++){r=stepH1Ai(r.ai,()=>{throw Error('early observation');});assert.equal(r.input.attacks.length,0);}
    r=stepH1Ai(r.ai,f.view);assert.equal(attackKey(r.input),'crouch-hp');
  }
  const f=fixture();f.self.action='guard';f.self.posture='crouch';
  assert.deepEqual(choose(f).input,{...N,axis:1,crouch:true});
  f.self.grounded=false;assert.deepEqual(choose(f).input,N);
});

test('A09: airborne opponent is approached only beyond 160, without attacks/jumps or boundary escapes',()=>{
  for(const side of [0,1])for(const d of [160,161]) {
    const f=fixture(d,side);f.other.grounded=false;
    assert.deepEqual(choose(f).input,{...N,axis:d===160?0:side===0?1:-1});
  }
  for(const side of [0,1]) {
    const f=fixture(72,side);f.c.fighters[0].x=side===0?80:1128;f.c.fighters[1].x=side===0?152:1200;
    f.self.action='guard';f.self.stun=10;
    const commands=[N,N];commands[side]=choose(f).input;
    const next=stepCombat(f.c,commands);assert.ok(next.fighters.every(p=>p.x>=80&&p.x<=1200));
    assert.ok(next.fighters[1].x-next.fighters[0].x>=72);
  }
});

test('A10: AI starts the same 12F/16 damage single-hit strong kick; descent cannot hit again',()=>{
  for(const side of [0,1]) {
    const f=fixture(153,side);let ai={...createH1Ai(),cursor:3},c=f.c;
    for(let age=0;age<=52;age++) {
      const r=stepH1Ai(ai,()=>observeH1Ai(c,side));ai=r.ai;
      const inputs=[N,N];inputs[side]=r.input;c=stepCombat(c,inputs);
      assert.equal(c.fighters[1-side].hp,age<12?100:84);
      if(age===0)assert.equal(c.fighters[side].attack.key,'stand-hk');
    }
    assert.equal(c.fighters[side].attack,null);
  }
});

test('A11: pause clears held input but preserves decision phase/cursor; no early read on resume',()=>{
  for(const ticks of [1,11,12,13]) {
    let s=playing();for(let i=0;i<ticks;i++)s=tick(s);
    const saved=structuredClone(s.ai);s=transition(s,pauseMatch(s.match,true));
    assert.equal(s.ai.untilDecision,saved.untilDecision);assert.equal(s.ai.cursor,saved.cursor);
    assert.equal(s.ai.axis,0);assert.equal(s.ai.crouch,false);
    const paused=s;for(let i=0;i<120;i++)s=tick(s);assert.deepEqual(s,paused);
    s=transition(s,pauseMatch(s.match,false));const x=s.match.combat.fighters[1].x;
    for(let i=0;i<saved.untilDecision;i++){s=tick(s);assert.equal(s.match.combat.fighters[1].x,x);}
    s=tick(s);assert.equal(s.match.combat.fighters[1].x,x-4);
  }
});

test('A12: timeout and KO on the first render callback prevent later AI ticks',()=>{
  for(const ko of [false,true]) {
    let s=playing();s.match.remainingFrames=1;
    if(ko){const [p,c]=s.match.combat.fighters;p.x=500;c.x=600;p.hp=8;c.action='attack';c.attack={key:'stand-lp',age:5,serial:1,hitTargets:[]};}
    new FixedStep().advance(1000,()=>s=tick(s));
    assert.equal(s.match.combat.frame,1);assert.equal(s.ai.untilDecision,11);assert.equal(s.ai.axis,0);
    assert.equal(s.match.result.reason,ko?'ko':'timeout-tie');
    const frozen=structuredClone(s.ai);for(let i=0;i<200;i++)s=tick(s,{...N,attacks:['hk']});
    assert.deepEqual(s.ai,frozen);assert.equal(s.match.combat.frame,1);
  }
});

test('A11: pausing during CPU attack preserves its attack and resumes without restarting it',()=>{
  let s=playing();s.match.combat.fighters[1].x=500;s=tick(s);
  assert.equal(s.match.combat.fighters[1].attack.key,'stand-lp');
  for(let i=0;i<3;i++)s=tick(s);
  s=transition(s,pauseMatch(s.match,true));const before=structuredClone(s);
  for(let i=0;i<120;i++)s=tick(s);assert.deepEqual(s,before);
  s=transition(s,pauseMatch(s.match,false));s=tick(s);
  assert.equal(s.match.combat.fighters[1].attack.serial,before.match.combat.fighters[1].attack.serial);
  assert.equal(s.match.combat.fighters[1].attack.age,before.match.combat.fighters[1].attack.age+1);
  assert.equal(s.ai.untilDecision,before.ai.untilDecision-1);
});

test('A13: round/replay/restart clear AI state on three repetitions, duplicate transitions preserve it',()=>{
  for(let repeat=0;repeat<3;repeat++) {
    let s=playing();for(let i=0;i<20;i++)s=tick(s);
    s.match.remainingFrames=1;s=tick(s);assert.equal(s.match.result.reason,'timeout-tie');
    s=transition(s,nextRound(s.match));assert.deepEqual(s.ai,createH1Ai());assert.equal(s.match.round,1);
    for(let win=0;win<2;win++) {
      s=tick(s);s.match.remainingFrames=1;s.match.combat.fighters[0].hp=50;s=tick(s);
      if(win===0){s=transition(s,nextRound(s.match));assert.equal(s.match.round,2);assert.deepEqual(s.ai,createH1Ai());}
    }
    s=transition(s,restartMatch(s.match));assert.equal(s.match.phase,'ready');assert.deepEqual(s.ai,createH1Ai());
    assert.deepEqual(s.match.wins,[0,0]);const prepared=s;for(let i=0;i<30;i++)s=tick(s);assert.deepEqual(s,prepared);
    assert.equal(transitionH1Ai(s.ai,s.match,restartMatch(s.match)),s.ai);
  }
});

test('A14: actual AI match is identical at 30/60/144Hz',()=>{
  const runs=[];
  for(const hz of [30,60,144]) {
    let s=playing();const clock=new FixedStep();
    for(let i=0;i<hz*60;i++)clock.advance(1000/hz,()=>s=tick(s));
    runs.push(s);assert.equal(s.match.result.winner,1);
  }
  assert.deepEqual(runs[0],runs[1]);assert.deepEqual(runs[1],runs[2]);
});

test('A15: unmodified start yields CPU 2:0 KO victory; player crouch guard holds through timeout',()=>{
  let s=playing();
  for(let round=1;round<=2;round++) {
    s=untilResult(s);assert.equal(s.match.result.reason,'ko');assert.equal(s.match.result.winner,1);
    assert.equal(s.match.combat.fighters[0].hp,0);assert.equal(s.match.combat.fighters[1].hp,100);
    assert.equal(s.match.wins[1],round);if(round===1)s=transition(s,nextRound(s.match));
  }
  assert.equal(s.match.phase,'match-result');s=transition(s,restartMatch(s.match));assert.deepEqual(s.ai,createH1Ai());
  const guard=untilResult(playing(),()=>({...N,axis:-1,crouch:true}));
  assert.equal(guard.match.result.reason,'timeout-tie');assert.deepEqual(guard.match.combat.fighters.map(f=>f.hp),[100,100]);
});

function cpuGrabBeforeContact(untilDecision,axis=1,crouch=true) {
  const s=playing();s.match.combat.fighters[0].x=500;s.match.combat.fighters[1].x=584;
  const grab={...N,attacks:['lp','hp'],handEvents:[
    {slot:'lp',down:true},{slot:'hp',down:true},{slot:'hp',down:false},{slot:'lp',down:false},
  ]};
  let combat=stepCombat(s.match.combat,[grab,N]);
  for(let age=1;age<=5;age++)combat=stepCombat(combat,[N,N]);
  assert.equal(combat.fighters[0].grab.age,5);
  assert.equal(combat.grabPair,null);
  return {match:{...s.match,combat},ai:{...createH1Ai(),cursor:5,untilDecision,axis,crouch}};
}

test('A16/G: actual CPU capture clears held input immediately and keeps its 12F clock and cursor through the lock',()=>{
  for(const axis of [-1,1])for(const crouch of [false,true]) {
    let s=cpuGrabBeforeContact(8,axis,crouch);
    s=tick(s);
    assert.equal(s.match.combat.grabPair.age,0);
    assert.equal(s.match.combat.fighters[1].grab.role,'target');
    assert.equal(s.match.combat.fighters[1].posture,crouch?'crouch':'stand');
    assert.deepEqual(s.ai,{cursor:5,untilDecision:7,axis:0,crouch:false});
    for(let age=1;age<=30;age++) {
      s=tick(s);const cpu=s.match.combat.fighters[1];
      assert.equal(s.ai.untilDecision,((7-age)%12+12)%12);
      assert.equal(s.ai.cursor,5);
      assert.equal(s.ai.axis,0);assert.equal(s.ai.crouch,false);
      assert.equal(cpu.attack,null);assert.equal(cpu.nextAttackId,1);
      assert.equal(cpu.action,age<30?'grab':'free');
      assert.equal(cpu.hp,age<18?100:82);
    }
    assert.equal(s.match.combat.fighters[0].action,'grab','the attacker remains locked when the CPU is released');
    s=tick(s);assert.equal(s.ai.untilDecision,0);assert.equal(s.match.combat.fighters[1].attack,null);
    s=tick(s);
    assert.equal(s.match.combat.fighters[1].attack.key,'crouch-hp');
    assert.equal(s.match.combat.fighters[1].attack.age,0);
    assert.equal(s.ai.cursor,6);assert.equal(s.ai.untilDecision,11);
  }
});

test('A17/G: a scheduled decision on H29 to H30 observes the prior lock and resumes at the following scheduled tick',()=>{
  let s=tick(cpuGrabBeforeContact(6));
  assert.equal(s.ai.untilDecision,5);
  for(let age=1;age<=29;age++)s=tick(s);
  assert.equal(s.match.combat.fighters[1].grab.age,29);
  assert.equal(s.ai.untilDecision,0);
  s=tick(s);
  assert.equal(s.match.combat.fighters[1].action,'free');
  assert.equal(s.match.combat.fighters[1].grab,null);
  assert.deepEqual(s.ai,{cursor:5,untilDecision:11,axis:0,crouch:false});
  const releasedX=s.match.combat.fighters[1].x;
  for(let age=31;age<=41;age++) {
    s=tick(s);const cpu=s.match.combat.fighters[1];
    assert.equal(s.ai.untilDecision,41-age);
    assert.equal(s.ai.cursor,5);
    assert.equal(cpu.x,releasedX);assert.equal(cpu.attack,null);
    assert.equal(cpu.action,'free');assert.equal(cpu.nextAttackId,1);
  }
  s=tick(s);
  assert.equal(s.match.combat.fighters[1].attack.key,'crouch-hp');
  assert.equal(s.match.combat.fighters[1].attack.age,0);
  assert.equal(s.ai.cursor,6);assert.equal(s.ai.untilDecision,11);
});
