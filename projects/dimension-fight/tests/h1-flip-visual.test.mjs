import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createCombat, stepCombat, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createMatch, startMatch, stepMatch, pauseMatch, nextRound } from '../src/combat/match.ts';
import { H1 } from '../src/characters/h1.ts';
import { combatPose, H1_POSES } from '../src/characters/h1-poses.ts';
import { combatVisuals } from '../src/characters/h1-visual.ts';
import { sampleCombatRender } from '../src/characters/h1-render.ts';
import { combatCamera, worldToScreen } from '../src/characters/h1-camera.ts';

const close = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-8, `${why}: ${a} != ${b}`);
const command = (owner, input) => owner === 0 ? [input, N] : [N, input];
const schedule = [[4,'jump-rise'],[6,'flip-lift'],[10,'flip-fold'],[17,'flip-tuck'],[29,'flip-coil'],[33,'flip-tuck'],[37,'flip-release'],[41,'flip-open'],[45,'jump-fall'],[48,'flip-landing']];
const expectedPose = tick => schedule.find(([end]) => tick < end)[1];

// Independent alpha>0 pixel-cell oracle. Row endpoints are sufficient for any linear
// projection, including rotations whose transparent bounding-box corners must be ignored.
const cache = new Map();
function pixels(pose) {
  if (cache.has(pose)) return cache.get(pose);
  const bytes = readFileSync(new URL(`../assets/characters/h1/derived/${H1_POSES[pose]}`, import.meta.url));
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
  assert.deepEqual([w,h,bytes[24],bytes[25],bytes[28]], [512,512,8,6,0]);
  const chunks = []; for (let at = 8; at < bytes.length;) { const n = bytes.readUInt32BE(at); if (bytes.toString('ascii', at+4, at+8) === 'IDAT') chunks.push(bytes.subarray(at+8, at+8+n)); at += n+12; }
  const packed = inflateSync(Buffer.concat(chunks)), stride = w*4, rgba = Buffer.alloc(stride*h);
  for (let y = 0; y < h; y++) {
    const filter = packed[y*(stride+1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i=y*stride+x,a=x>=4?rgba[i-4]:0,b=y?rgba[i-stride]:0,c=y&&x>=4?rgba[i-stride-4]:0,p=a+b-c;
      const pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
      const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c;
      rgba[i]=(packed[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  const points=[];
  for(let y=0;y<h;y++) {
    let left=w,right=-1;
    for(let x=0;x<w;x++) if(rgba[(y*w+x)*4+3]>0){left=Math.min(left,x);right=x;}
    if(right>=left) points.push([left,y],[right+1,y],[left,y+1],[right+1,y+1]);
  }
  assert.ok(points.length); cache.set(pose,points); return points;
}
function inspect(render, owner) {
  const f=render.fighters[owner],v=render.visuals[owner],pose=render.poses[owner],r=v.angle*Math.PI/180;
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(const [x,y] of pixels(pose)) {
    const dx=(x-256)*.625*f.facing,dy=(y-512*v.originY)*.625;
    const wx=v.x+dx*Math.cos(r)-dy*Math.sin(r),wy=v.y+dx*Math.sin(r)+dy*Math.cos(r);
    const p=worldToScreen(render.camera,wx,wy);
    left=Math.min(left,p.x);right=Math.max(right,p.x);top=Math.min(top,p.y);bottom=Math.max(bottom,p.y);
    assert.ok(Math.abs(wx-f.x)<=192+1e-8,`${pose} angle${v.angle}: alpha exceeds the fixed 192px root envelope at ${wx-f.x}`);
  }
  assert.ok(left>=-1e-8&&right<=1280+1e-8&&top>=-1e-8&&bottom<=720+1e-8,`${pose} clips at [${left},${right}] x [${top},${bottom}]`);
}
function inspectRotationInterval(start,end,owner) {
  const f=end.fighters[owner],v=end.visuals[owner],pose=end.poses[owner];
  const angles=[start.visuals[owner].angle,end.visuals[owner].angle].map(a=>a*Math.PI/180);
  const lo=Math.min(...angles),hi=Math.max(...angles);
  // With the same sampled root, rotated x extrema occur at an interval endpoint
  // or atan2(-dy,dx)+k*pi. Check them all, not only chosen render-rate samples.
  for(const [x,y] of pixels(pose)) {
    const dx=(x-256)*.625*f.facing,dy=(y-512*v.originY)*.625;
    const peak=Math.atan2(-dy,dx),candidates=[lo,hi];
    for(let k=Math.ceil((lo-peak)/Math.PI);k<=Math.floor((hi-peak)/Math.PI);k++)candidates.push(peak+k*Math.PI);
    for(const a of candidates) assert.ok(Math.abs(dx*Math.cos(a)-dy*Math.sin(a))<=192+1e-8,
      `${pose}: continuous rotation at ${a*180/Math.PI} exceeds the fixed root envelope`);
  }
}

test('A complete jump selects explicit in-between intervals and advances one forward turn from its original ballistic clock', () => {
  for(const direction of [-1,1]) for(const owner of [0,1]) {
    let s=createCombat(); s.fighters[owner].x=640-direction*42;s.fighters[1-owner].x=640+direction*42;
    const start=s.fighters[owner].x;
    for(let tick=1;tick<=48;tick++) {
      s=stepCombat(s,command(owner,{...N,axis:direction,jump:tick===1}));
      const f=s.fighters[owner],v=combatVisuals(s)[owner];
      close(f.x,start+direction*tick*4,'physics uses its unchanged 4px step');
      if(tick<48) {
        assert.equal(combatPose(f,H1),expectedPose(tick));
        close(v.angle,direction*tick*7.5,'unwrapped forward rotation');
        close(v.x,f.x,'no horizontal pose adjustment');close(v.y,f.y-120,'body-center pivot');assert.equal(v.originY,.5);
      } else { assert.equal(f.grounded,true);assert.equal(f.facing,-direction);assert.equal(v.angle,0);assert.equal(v.originY,.875);close(v.y,600,'landed root'); }
    }
  }
});

test('Actual PNG alpha remains inside the fixed camera envelope throughout mirrored flips and fractional renders', () => {
  for(const [a,b] of [[80,1200],[1200,80],[80,164],[1200,1116],[400,880]]) for(const owner of [0,1]) for(const moving of [false,true]) {
    let s=createCombat();s.fighters[owner].x=a;s.fighters[1-owner].x=b;const direction=b>a?1:-1;
    for(let tick=1;tick<=48;tick++) {
      const previous=s;s=stepCombat(s,command(owner,{...N,axis:moving?direction:0,jump:tick===1}));
      const saved=structuredClone(s);
      inspectRotationInterval(sampleCombatRender(previous,s,0),sampleCombatRender(previous,s,1),owner);
      for(const alpha of [0,.25,.5,.75,1]) {
        const render=sampleCombatRender(previous,s,alpha);inspect(render,owner);
        assert.deepEqual(render.camera,combatCamera({fighters:render.fighters}),'camera and artwork share the sampled roots');
      }
      assert.deepEqual(s,saved,'rendering cannot mutate the flight or its clock');
    }
  }
});

test('Airborne hit and KO snap out of rotation, and recovered midair hitstun cannot resume the flip', () => {
  for(const ko of [false,true]) {
    let s=createCombat();s.fighters[0].x=500;s.fighters[1].x=584;
    Object.assign(s.fighters[0],{action:'attack',attack:{key:'stand-lp',serial:1,age:5,hitTargets:[]}});
    Object.assign(s.fighters[1],{grounded:false,state:'jump',y:550,vy:-500,hp:ko?8:100});
    const before=s;s=stepCombat(s,[N,N]);
    assert.equal(s.fighters[1].jumpInterrupted,true);
    const render=sampleCombatRender(before,s,.1);assert.equal(render.visuals[1].angle,0);assert.equal(render.visuals[1].originY,.875);
    assert.equal(render.poses[1],ko?'ko-0':'stand-hit');
    assert.deepEqual(render.fighters,s.fighters,'contact must show its immediate logical displacement');
    if(ko) { assert.equal(render.visuals[1].y,600);assert.equal(stepCombat(s,[N,N]),s);continue; }
    for(let tick=0;tick<17;tick++)s=stepCombat(s,[N,N]);
    assert.equal(s.fighters[1].action,'free');assert.equal(s.fighters[1].grounded,false);
    assert.equal(combatVisuals(s)[1].angle,0);assert.equal(combatVisuals(s)[1].y,s.fighters[1].y);
    assert.match(combatPose(s.fighters[1],H1),/^jump-(rise|apex|fall)$/);
    while(!s.fighters[1].grounded)s=stepCombat(s,[N,N]);
    s=stepCombat(s,[N,{...N,jump:true}]);assert.equal(s.fighters[1].jumpInterrupted,false);
    close(Math.abs(combatVisuals(s)[1].angle),7.5,'a fresh jump starts a fresh flip');
  }
});

test('Pause and timeout freeze the exact airborne flip while replay clears its pose and rotation', () => {
  let m=startMatch(createMatch());
  for(let tick=0;tick<20;tick++)m=stepMatch(m,[{...N,jump:tick===0},N]);
  const pose=combatPose(m.combat.fighters[0],H1),visual=combatVisuals(m.combat)[0];
  m=pauseMatch(m,true);const paused=m;
  for(let tick=0;tick<20;tick++)m=stepMatch(m,[N,N]);assert.equal(m,paused);
  assert.equal(combatPose(m.combat.fighters[0],H1),pose);assert.deepEqual(combatVisuals(m.combat)[0],visual);
  m=pauseMatch(m,false);m={...m,remainingFrames:1};m=stepMatch(m,[N,N]);
  const result=sampleCombatRender(null,m.combat,0);assert.equal(m.result.reason,'timeout-tie');
  for(let tick=0;tick<20;tick++){m=stepMatch(m,[N,N]);assert.deepEqual(sampleCombatRender(null,m.combat,.7),result);}
  m=nextRound(m);assert.equal(combatPose(m.combat.fighters[0],H1),'idle-0');assert.equal(combatVisuals(m.combat)[0].angle,0);
});
