import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { H1 } from '../src/characters/h1.ts';
import { H1_POSES, H1_PREVIOUS_HEAVY_POSES, combatPose } from '../src/characters/h1-poses.ts';
import { createCombat, stepCombat, clearGrabs, attackPhase, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';

test('All 145 distinct pose keys resolve to existing sprite files, preserving the original heavy artwork', () => {
  assert.equal(Object.keys(H1_POSES).length,145);
  assert.equal(new Set(Object.values(H1_POSES)).size,145);
  for(const path of Object.values(H1_POSES)) assert.ok(existsSync(new URL(`../assets/characters/h1/derived/${path}`,import.meta.url)),path);
  assert.equal(Object.keys(H1_PREVIOUS_HEAVY_POSES).length,26);
  for(const [pose,path] of Object.entries(H1_POSES)) {
    assert.equal(path.startsWith('opposite-limbs-v1/'), /^(stand|crouch)-h[pk]-/.test(pose) && !pose.endsWith('-mid'), pose);
  }
  for(const path of Object.values(H1_PREVIOUS_HEAVY_POSES)) assert.ok(existsSync(new URL(`../assets/characters/h1/derived/${path}`,import.meta.url)),path);
});
test('Every attack uses the combat age for startup/active/recovery and exits at its total length', () => {
  // Explicit smooth-frame durations; original startup/active/recovery totals remain unchanged.
  const fixture = {
    'stand-lp': [['stand-lp-startup',2],['lp-extend',2],['stand-lp-start-mid',2],['stand-lp-active',3],['lp-retract',4],['stand-lp-recover-mid',4],['stand-lp-recovery',4],['lp-settle',3]],
    'stand-hp': [['startup',4],['start-mid',3],['extend',3],['active',3],['retract',6],['recover-mid',5],['recovery',5],['settle',5]],
    'stand-lk': [['startup',3],['extend',3],['start-mid',2],['active',4],['retract',5],['recover-mid',4],['recovery',5],['settle',4]],
    'stand-hk': [['startup',4],['start-mid',4],['lift',4],['apex',4],['descend',6],['active',6],['retract',6],['recover-mid',6],['recovery',6],['settle',6]],
    'crouch-lp': [['startup',2],['extend',2],['start-mid',2],['active',3],['retract',4],['recover-mid',4],['recovery',4],['settle',3]],
    'crouch-hp': [['startup',4],['start-mid',3],['extend',3],['active',3],['retract',6],['recover-mid',5],['recovery',5],['settle',5]],
    'crouch-lk': [['startup',3],['extend',3],['start-mid',2],['active',4],['retract',5],['recover-mid',4],['settle',5],['recovery',4]],
    'crouch-hk': [['startup',5],['start-mid',5],['extend',4],['active',4],['retract',6],['recover-mid',6],['settle',6],['recovery',6]],
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

test('Walking presents 24 alternating key and middle poses for two frames each; idle remains a 30F cycle', () => {
  const poses=Array.from({length:12},(_,i)=>{const n=String(i).padStart(2,'0');return [`walk-${n}`,`walk-mid-${n}`];}).flat();
  const f=createCombat().fighters[0];
  for(let cycle=0;cycle<3;cycle++) for(let segment=0;segment<24;segment++) for(let offset=0;offset<2;offset++) {
    assert.equal(combatPose({...f,state:'walk',age:cycle*48+segment*2+offset},H1),poses[segment]);
  }
  const idle=[...Array(8).fill('idle-0'),...Array(7).fill('idle-in'),...Array(8).fill('idle-1'),...Array(7).fill('idle-out')];
  for(let age=0;age<90;age++) assert.equal(combatPose({...f,age},H1),idle[age%30]);
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
    assert.equal(combatPose({...f,action,posture,state:'walk',stun:5},H1),`${posture}-${action}`);
    for(const stun of [0,1,4]) {
      assert.equal(combatPose({...f,action,posture,state:'walk',stun},H1),`${posture}-${action}${action==='hit'?'-settle':''}`);
      if(action==='hit') assert.equal(combatPose({...f,action,posture,state:'jump',grounded:false,stun},H1),`${posture}-hit`);
    }
  }
});
test('KO adds middle artwork at F3 and F9 but retains the final pose from F12 and the 18F result duration', () => {
  const f=createCombat().fighters[0];
  const ko={...f,action:'ko',attack:{key:'stand-lp',age:6,serial:1,hitTargets:[]}};
  for(const [frame,expected] of [[0,'ko-0'],[2,'ko-0'],[3,'ko-mid-01'],[5,'ko-mid-01'],[6,'ko-1'],[8,'ko-1'],[9,'ko-mid-12'],[11,'ko-mid-12'],[12,'ko-2'],[17,'ko-2'],[18,'ko-2'],[999,'ko-2']]) assert.equal(combatPose(ko,H1,frame),expected);
  const winner={...f,state:'walk',age:7};
  assert.equal(combatPose(winner,H1,0),combatPose(winner,H1,18));
});
test('Missing attack phase cannot silently render an idle placeholder', () => {
  const f=createCombat().fighters[0];
  assert.throws(()=>combatPose({...f,action:'attack',attack:{key:'stand-lp',age:24,serial:1,hitTargets:[]}},H1),/outside/);
});

const grabCommand = { ...N, attacks: ['lp', 'hp'], handEvents: [
  { slot: 'lp', down: true }, { slot: 'hp', down: true },
  { slot: 'hp', down: false }, { slot: 'lp', down: false },
] };
function grabPoseTick(s, side = 0, own = N, other = N) {
  return stepCombat(s, side === 0 ? [own, other] : [other, own]);
}
function grabbedScene(posture = 'stand', side = 0, reversed = false, targetHp = 100) {
  let s = createCombat();
  s.fighters[0].x = reversed ? 584 : 500; s.fighters[1].x = reversed ? 500 : 584;
  s.fighters[1 - side].hp = targetHp;
  const targetInput = { ...N, crouch: posture === 'crouch' };
  s = grabPoseTick(s, side, grabCommand, targetInput);
  for (let age = 0; age <= 5; age++) {
    assert.equal(combatPose(s.fighters[side], H1), age < 3 ? 'grab-ready' : 'grab-reach');
    s = grabPoseTick(s, side, N, targetInput);
  }
  assert.equal(s.grabPair?.age, 0);
  return s;
}

test('Throw artwork follows hold, turn, lift, slam and living get-up with independent release boundaries', () => {
  // Approved throw revision: impact H36, attacker release H54, target release H72.
  for (const posture of ['stand', 'crouch']) for (const side of [0, 1]) for (const reversed of [false, true]) {
    let s = grabbedScene(posture, side, reversed);
    const target = 1 - side, initial = s.fighters.map(f => f.x), direction = s.fighters[side].facing;
    for (let age = 0; age <= 72; age++) {
      const attackerPose = combatPose(s.fighters[side], H1), targetPose = combatPose(s.fighters[target], H1);
      assert.equal(s.fighters[target].hp, age < 36 ? 100 : 82);
      assert.equal(s.fighters[target].x, initial[target] + (age < 36 ? 0 : direction * 48));
      assert.equal(s.fighters[side].x, initial[side]);
      if (age < 13) assert.equal(attackerPose, `grab-${posture}-hold`);
      else if (age < 17) assert.equal(attackerPose, 'throw-turn');
      else if (age < 20) assert.equal(attackerPose, 'throw-turn-mid');
      else if (age < 24) assert.equal(attackerPose, 'throw-lift');
      else if (age < 28) assert.equal(attackerPose, 'throw-drop-mid');
      else if (age < 45) assert.equal(attackerPose, 'throw-slam');
      else if (age < 54) assert.equal(attackerPose, 'grab-settle');
      else assert.match(attackerPose, /^idle-/);
      if (age < 20) assert.equal(targetPose, `grabbed-${posture}-hold`);
      else if (age < 36) assert.equal(targetPose, 'thrown-air');
      else if (age < 48) assert.equal(targetPose, 'thrown-down');
      else if (age < 54) assert.equal(targetPose, 'thrown-rise-mid');
      else if (age < 60) assert.equal(targetPose, 'thrown-rise');
      else if (age < 72) assert.equal(targetPose, `grabbed-${posture}-recover`);
      else if (posture === 'crouch') assert.equal(targetPose, 'crouch');
      else assert.match(targetPose, /^idle-/);
      assert.equal(s.fighters[target].action, age < 72 ? 'grab' : 'free');
      assert.equal(s.fighters[side].action, age < 54 ? 'grab' : 'free');
      assert.ok(!targetPose.startsWith('ko-'), 'a living target never uses a KO fallback');
      s = grabPoseTick(s, side, N, { ...N, crouch: posture === 'crouch' });
    }
  }
});

test('A real escape separates hands immediately, shows role-specific recovery and exits at T+12', () => {
  for (const posture of ['stand', 'crouch']) for (const side of [0, 1]) {
    let s = grabbedScene(posture, side);
    const target = 1 - side, initial = s.fighters.map(f => f.x);
    s = grabPoseTick(s, side, N, grabCommand);
    assert.deepEqual(s.grabEvents.map(e => e.kind), ['escape']);
    assert.deepEqual(s.fighters.map(f => f.x), [initial[0] - 16, initial[1] + 16]);
    for (let age = 0; age <= 12; age++) {
      const attackerPose = combatPose(s.fighters[side], H1), targetPose = combatPose(s.fighters[target], H1);
      assert.deepEqual(s.fighters.map(f => f.hp), [100, 100]);
      if (age < 4) {
        assert.equal(attackerPose, age < 2 ? 'grab-release' : 'grab-release-mid');
        assert.equal(targetPose, `grabbed-${posture}-escape`);
      } else if (age < 12) {
        assert.equal(attackerPose, age < 8 ? 'grab-retract' : 'grab-settle');
        assert.equal(targetPose, `grabbed-${posture}-recover`);
      } else {
        assert.match(attackerPose, /^idle-/);
        if (posture === 'crouch') assert.equal(targetPose, 'crouch');
        else assert.match(targetPose, /^idle-/);
      }
      s = grabPoseTick(s, side, N, { ...N, crouch: posture === 'crouch' });
    }
  }
});

test('Clearing actual grab locks retains distinct final pose snapshots without mutating the live state', () => {
  const scenes = [];
  let attempt = grabPoseTick(createCombat(), 0, grabCommand);
  for (let i = 0; i < 12; i++) attempt = grabPoseTick(attempt);
  scenes.push(attempt);
  for (const posture of ['stand', 'crouch']) {
    let success = grabbedScene(posture);
    // Each animation transition can be the final timeout frame, including after the attacker releases.
    for (let age = 0; age < 72; age++) {
      if ([12,13,16,17,19,20,23,24,27,28,35,36,44,45,47,48,53,54,59,60,71].includes(age)) scenes.push(success);
      success = grabPoseTick(success);
    }
    scenes.push(grabPoseTick(grabbedScene(posture), 0, N, grabCommand));
  }
  for (const live of scenes) {
    const before = structuredClone(live), expected = live.fighters.map(f => combatPose(f, H1));
    const cleared = clearGrabs(live);
    assert.deepEqual(live, before);
    assert.equal(cleared.grabPair, null);
    assert.ok(cleared.fighters.every(f => f.grab === null && f.action !== 'grab'));
    for (let i = 0; i < 2; i++) {
      if (live.fighters[i].grab) {
        assert.deepEqual(cleared.fighters[i].grabSnapshot, live.fighters[i].grab);
        assert.notEqual(cleared.fighters[i].grabSnapshot, live.fighters[i].grab);
      }
      assert.equal(combatPose(cleared.fighters[i], H1, 999), expected[i]);
    }
    assert.deepEqual(clearGrabs(cleared), cleared);
  }
});

test('Actual throw impact KO stays down while the winner keeps its final slam snapshot', () => {
  for (const posture of ['stand', 'crouch']) for (const side of [0, 1]) {
    let s = grabbedScene(posture, side, false, 9);
    for (let i = 0; i < 36; i++) s = grabPoseTick(s);
    const target = 1 - side;
    assert.equal(s.ended, true);
    assert.equal(s.fighters[target].hp, 0);
    assert.equal(s.fighters[target].action, 'ko');
    assert.ok(s.fighters[target].grabSnapshot, 'the retained throw visual keeps a KO target on the ground');
    assert.equal(s.grabPair, null);
    for (const age of [0,5,6,11,12,17,18,999]) {
      assert.equal(combatPose(s.fighters[target], H1, age), 'thrown-down');
      assert.equal(combatPose(s.fighters[side], H1, age), 'throw-slam');
    }
    assert.deepEqual(grabPoseTick(s, side, grabCommand, grabCommand), s);
  }
});
