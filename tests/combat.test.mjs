import test from 'node:test';
import assert from 'node:assert/strict';
import { H1 } from '../src/characters/h1.ts';
import { validateCharacter } from '../src/combat/definition.ts';
import { createCombat, stepCombat, attackPhase, overlaps, worldRect, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { CombatInputBuffer } from '../src/input/combat-input.ts';
import { FixedStep } from '../src/combat/fixed-step.ts';

const input = (changes = {}) => ({ ...N, ...changes });
const tick = (s, a = N, b = N) => stepCombat(s, [a, b]);
function close(distance = 100, reversed = false) {
  const s = createCombat();
  s.fighters[0].x = reversed ? 500 + distance : 500;
  s.fighters[1].x = reversed ? 500 : 500 + distance;
  s.fighters[0].facing = reversed ? -1 : 1;
  s.fighters[1].facing = reversed ? 1 : -1;
  return s;
}
// Inject an explicitly timed public combat state to isolate a contact boundary.
function attacking(s, i, key, ageBeforeTick, serial = 1) {
  Object.assign(s.fighters[i], { action: 'attack', posture: key.startsWith('crouch') ? 'crouch' : 'stand',
    attack: { key, serial, age: ageBeforeTick, hitTargets: [] }, nextAttackId: serial + 1 });
  return s;
}
function contact(key = 'stand-lp', defender = N, reversed = false) {
  const s = attacking(close(90, reversed), 0, key, H1.attacks[key].startup - 1);
  return tick(s, N, defender);
}

test('Approved eight attacks: independent numeric fixture matches v0.3', () => {
  const expected = {
    'stand-lp': [6,3,15,8,16,8,24,8,'normal',104,-190,-100],
    'stand-hp': [10,3,21,12,20,10,36,12,'normal',124,-190,-100],
    'stand-lk': [8,4,18,10,18,10,32,10,'normal',134,-155,-65],
    'stand-hk': [24,4,24,16,24,12,48,16,'overhead',154,-155,-65],
    'crouch-lp': [6,3,15,6,16,8,24,8,'normal',96,-115,-65],
    'crouch-hp': [10,3,21,10,20,10,36,12,'normal',112,-115,-65],
    'crouch-lk': [8,4,18,8,18,10,32,10,'low',124,-60,-10],
    'crouch-hk': [14,4,24,14,24,12,48,16,'low',144,-60,-10],
  };
  assert.deepEqual(Object.keys(H1.attacks), Object.keys(expected));
  for (const [key, e] of Object.entries(expected)) {
    const a = H1.attacks[key];
    assert.deepEqual([a.startup,a.active,a.recovery,a.damage,a.hitstun,a.blockstun,a.push,a.blockPush,a.height,a.box.right,a.box.top,a.box.bottom],e);
    assert.equal(a.box.left,36);
  }
  assert.deepEqual(H1.hurt, {stand:{left:-36,right:36,top:-220,bottom:0},crouch:{left:-36,right:36,top:-120,bottom:0}});
});

for (const [key, a] of Object.entries(H1.attacks)) {
  test(`${key}: startup/active/recovery edges, total duration and one hit`, () => {
    const P = a.startup, A = a.active, total = P + A + a.recovery;
    for (const [age, phase, damage] of [[P-1,'startup',0],[P,'active',a.damage],[P+A-1,'active',a.damage],[P+A,'recovery',0],[total-1,'recovery',0]]) {
      const s = tick(attacking(close(),0,key,age-1));
      assert.equal(attackPhase(s.fighters[0],H1),phase,`age ${age}`);
      assert.equal(s.fighters[1].hp,100-damage,`age ${age}`);
    }
    let s = tick(close(),input({crouch:key.startsWith('crouch'),attacks:[key.split('-')[1]]}));
    assert.equal(s.fighters[0].attack.age,0);
    let hits=0;
    for (let i=1;i<=total;i++) { s=tick(s); hits+=s.events.length; }
    assert.equal(hits,1); assert.equal(s.fighters[1].hp,100-a.damage);
    assert.equal(s.fighters[0].action,'free'); assert.equal(s.fighters[0].attack,null);
  });
  test(`${key}: touching edge misses, 1px overlap hits, mirrored on either side`, () => {
    for (const reverse of [false,true]) for (const overlap of [0,1]) {
      const distance = a.box.right + 36 - overlap;
      const s = tick(attacking(close(distance,reverse),0,key,a.startup-1));
      assert.equal(s.fighters[1].hp,overlap ? 100-a.damage : 100);
    }
  });
}

test('Both axes require positive overlap; mirroring uses root, not image dimensions', () => {
  const a={left:0,right:10,top:0,bottom:10};
  assert.equal(overlaps(a,{...a,top:10,bottom:20}),false);
  assert.equal(overlaps(a,{...a,top:9,bottom:20}),true);
  assert.deepEqual(worldRect(H1.attacks['stand-lp'].box,{x:500,y:600,facing:-1}),{left:396,right:464,top:410,bottom:500});
  const s=attacking(close(),0,'stand-lp',5);
  s.fighters[1].y=190; s.fighters[1].grounded=false;
  assert.equal(tick(s).events.length,0);
});

for (const [key, expected] of [['stand-lp',[false,true,true]],['stand-hk',[false,true,false]],['crouch-lk',[false,false,true]]]) {
  test(`${key}: guard table none/standing/crouching and mirrored back direction`, () => {
    for (const reversed of [false,true]) {
      const away=reversed?-1:1;
      for (const [index, guard] of [N,input({axis:away}),input({axis:away,crouch:true})].entries()) {
        const s=contact(key,guard,reversed);
        assert.equal(s.events.length,1); assert.equal(s.events[0].blocked,expected[index]);
        assert.equal(s.fighters[1].hp, expected[index]?100:100-H1.attacks[key].damage);
      }
    }
  });
}
test('No auto guard from forward/crouch alone, and no guard event without overlap', () => {
  for(const guard of [input({axis:-1}),input({crouch:true}),input({axis:-1,crouch:true})]) {
    assert.equal(contact('stand-lp',guard).events[0].blocked,false);
  }
  const s=tick(attacking(close(300),0,'stand-lp',5),N,input({axis:1}));
  assert.equal(s.events.length,0); assert.equal(s.fighters[1].action,'free');
  assert.equal(s.fighters[1].x,804); // Backward movement remains movement until a contact.
});
test('Attack start locks posture/facing, beats jump and disables backward guard', () => {
  let s=tick(close(300),input({axis:-1,crouch:true,jump:true,attacks:['lp','hp','lk','hk']}));
  assert.equal(s.fighters[0].attack.key,'crouch-hk'); assert.equal(s.fighters[0].x,500);
  assert.equal(s.fighters[0].grounded,true);
  s=tick(s,input({axis:-1})); assert.equal(s.fighters[0].posture,'crouch'); assert.equal(s.fighters[0].facing,1);
  s=attacking(close(),0,'stand-lp',5);
  s=tick(s,N,input({axis:1,attacks:['hk']}));
  assert.equal(s.events[0].blocked,false); assert.equal(s.fighters[1].action,'hit');
  assert.equal(s.fighters[1].attack,null);
});
test('Guard contact remains in attack history after defender changes posture', () => {
  let s=contact('stand-lp',input({axis:1}));
  assert.deepEqual(s.fighters[0].attack.hitTargets,[1]);
  s=tick(s,N,input({axis:1,crouch:true}));
  assert.equal(s.fighters[1].posture,'crouch'); assert.equal(s.events.length,0); assert.equal(s.fighters[1].hp,100);
});
test('Hitstun blocks exactly N subsequent updates, fixes crouch posture, then accepts new input', () => {
  let s=contact('stand-lp',input({crouch:true}));
  assert.equal(s.fighters[1].stun,16);
  for(let i=0;i<16;i++) {
    s=tick(s,N,input({axis:1,jump:true,attacks:['hk']}));
    assert.equal(s.fighters[1].action,'hit'); assert.equal(s.fighters[1].posture,'crouch');
    assert.equal(s.fighters[1].x,614); assert.equal(s.fighters[1].attack,null);
  }
  assert.equal(s.fighters[1].stun,0);
  s=tick(s,N,input({attacks:['lp']}));
  assert.equal(s.fighters[1].attack.key,'stand-lp');
});
test('Blockstun ignores attacks and jump; releasing back does not end stun or auto-block a new hit', () => {
  let s=contact('stand-lp',input({axis:1})); const x=s.fighters[1].x;
  for(let i=0;i<8;i++) {
    s=tick(s,N,input({axis:1,jump:true,attacks:['hk']}));
    assert.equal(s.fighters[1].action,'guard'); assert.equal(s.fighters[1].x,x); assert.equal(s.fighters[1].grounded,true);
  }
  s=tick(s); assert.equal(s.fighters[1].action,'free');
  s=contact('stand-lp',input({axis:1}));
  attacking(s,0,'stand-lp',5,2);
  s=tick(s); assert.equal(s.events[0].blocked,false); assert.equal(s.fighters[1].stun,16);
});
test('New guard uses current crouch and replaces stun; hits during hitstun replace stun without invulnerability', () => {
  let s=contact('stand-lp',input({axis:1}));
  attacking(s,0,'crouch-lk',7,2); s=tick(s,N,input({axis:1,crouch:true}));
  assert.equal(s.events[0].blocked,true); assert.equal(s.fighters[1].stun,10);
  s=contact('stand-lp');
  attacking(s,0,'stand-hp',9,2); s=tick(s);
  assert.equal(s.fighters[1].hp,80); assert.equal(s.fighters[1].stun,20);
});
test('Simultaneous active attacks both hit before cancellation, with mirrored pushes', () => {
  let s=attacking(attacking(close(),0,'stand-lp',5),1,'stand-lp',5);
  const before=structuredClone(s); s=tick(s);
  assert.equal(s.events.length,2);
  assert.deepEqual(s.fighters.map(f=>f.hp),[92,92]);
  assert.deepEqual(s.fighters.map(f=>f.x),[476,624]);
  assert.ok(s.fighters.every(f=>f.action==='hit' && f.attack===null));
  assert.deepEqual(before.fighters.map(f=>f.hp),[100,100]);
  assert.deepEqual(before.fighters.map(f=>f.attack.hitTargets),[[],[]]);
});
test('Corner pushes are clamped on either side without breaking minimum gap', () => {
  for(const reverse of [false,true]) {
    const s=attacking(close(72,reverse),0,'stand-hk',23);
    s.fighters[0].x=reverse?152:1128; s.fighters[1].x=reverse?80:1200;
    const result=tick(s);
    assert.equal(result.fighters[1].x,reverse?80:1200);
    assert.equal(Math.abs(result.fighters[0].x-result.fighters[1].x),72);
  }
});
test('Airborne input is discarded, back does not guard, gravity and vertical speed survive hits', () => {
  let s=attacking(close(),0,'stand-lp',5);
  Object.assign(s.fighters[1],{grounded:false,y:550,vy:-200});
  s=tick(s,N,input({axis:1,jump:true,attacks:['hk']}));
  assert.equal(s.events[0].blocked,false); assert.equal(s.fighters[1].action,'hit');
  assert.ok(Math.abs(s.fighters[1].vy-(-200+2000/60))<1e-9);
  const x=s.fighters[1].x, y=s.fighters[1].y;
  s=tick(s,N,input({axis:1})); assert.equal(s.fighters[1].x,x); assert.ok(s.fighters[1].y<y);
  s=createCombat(); s=tick(s,input({jump:true}));
  s=tick(s,input({attacks:['hk']}));
  for(let i=0;i<60;i++) s=tick(s,input({crouch:true}));
  assert.equal(s.fighters[0].action,'free'); assert.equal(s.fighters[0].posture,'crouch'); assert.equal(s.fighters[0].attack,null);
});
test('Jump started on the contact tick loses back guard immediately', () => {
  const s=tick(attacking(close(),0,'stand-lp',5),N,input({axis:1,jump:true}));
  assert.equal(s.events[0].blocked,false); assert.equal(s.fighters[1].grounded,false);
});
test('KO clamps health, double KO applies both hits, further updates do not mutate the result', () => {
  let s=attacking(attacking(close(),0,'stand-lp',5),1,'stand-lp',5);
  s.fighters[0].hp=1; s.fighters[1].hp=8; s=tick(s);
  assert.deepEqual(s.fighters.map(f=>f.hp),[0,0]); assert.equal(s.ended,true);
  assert.ok(s.fighters.every(f=>f.action==='ko'));
  const frozen=structuredClone(s);
  for(let i=0;i<60;i++) s=tick(s,input({axis:1,attacks:['hk']}),input({axis:-1,attacks:['hk']}));
  assert.deepEqual(s,frozen);
  const fresh=createCombat(); assert.deepEqual(fresh.fighters.map(f=>[f.hp,f.nextAttackId,f.attack,f.stun]),[[100,1,null,0],[100,1,null,0]]);
});
test('Air KO freezes logical airborne position; visual floor alignment is a later rendering concern', () => {
  let s=attacking(close(),0,'stand-lp',5); Object.assign(s.fighters[1],{grounded:false,y:550,vy:-100,hp:1});
  s=tick(s); const y=s.fighters[1].y; assert.equal(s.ended,true); assert.ok(y<600);
  assert.equal(tick(s).fighters[1].y,y);
});
test('Input pulses: all attack keys, priority, physical repeats, inactive/reset release and opposite directions', () => {
  const b=new CombatInputBuffer();
  for(const [code,slot] of [['KeyU','lp'],['KeyI','hp'],['KeyJ','lk'],['KeyK','hk']]) {
    b.keyDown(code); assert.deepEqual(b.sample().attacks,[slot]); b.keyDown(code,true);
    assert.deepEqual(b.sample().attacks,[]); b.keyUp(code);
  }
  for(const code of ['KeyU','KeyI','KeyJ','KeyK','KeyW','KeyS','KeyA','KeyD']) b.keyDown(code);
  const all=b.sample(); assert.equal(all.axis,0); assert.equal(all.crouch,false); assert.equal(all.jump,false);
  assert.equal(tick(createCombat(),all).fighters[0].attack.key,'stand-hk');
  b.reset(); assert.deepEqual(b.sample(),N); b.keyDown('KeyU'); assert.deepEqual(b.sample().attacks,[]);
  b.keyUp('KeyU'); b.keyDown('KeyU',false,false); b.keyDown('KeyU'); assert.deepEqual(b.sample().attacks,[]);
  b.keyUp('KeyU'); b.keyDown('KeyU'); assert.deepEqual(b.sample().attacks,['lp']);
});
test('Held attack and pulses pressed during recovery never replay when free', () => {
  const b=new CombatInputBuffer(); let s=close(400); b.keyDown('KeyU');
  s=tick(s,b.sample());
  for(let i=1;i<60;i++) {
    if(i===10)b.keyDown('KeyK');
    if(i===11)b.keyUp('KeyK');
    b.keyDown('KeyU',true); s=tick(s,b.sample());
  }
  assert.equal(s.fighters[0].nextAttackId,2); assert.equal(s.fighters[0].action,'free');
  b.keyUp('KeyU'); b.keyDown('KeyU'); s=tick(s,b.sample()); assert.equal(s.fighters[0].attack.serial,2);
});
test('Logical input replay is identical at 30/60/144 render Hz', () => {
  const outcomes=[];
  for(const hz of [30,60,144]) {
    let s=close(), frame=0; const clock=new FixedStep();
    for(let render=0;render<hz*2;render++) clock.advance(1000/hz,()=>{
      const a=input({crouch:frame>=40&&frame<80,attacks:frame===0?['lp']:frame===40?['lk']:[]});
      const b=input({axis:frame<20?1:0,crouch:frame>=40&&frame<60});
      s=tick(s,a,b); frame++;
    });
    outcomes.push(s);
  }
  assert.deepEqual(outcomes[0],outcomes[1]); assert.deepEqual(outcomes[1],outcomes[2]);
});
test('Different character data uses the same combat path; fighter runtime state is independent', () => {
  const other=structuredClone(H1); other.id='fixture'; other.maxHp=120; other.attacks['stand-lp'].damage=3;
  const s=createCombat([other,H1]); s.fighters[0].x=500;s.fighters[1].x=600;
  attacking(s,0,'stand-lp',5); const result=tick(s);
  assert.deepEqual(result.fighters.map(f=>f.hp),[120,97]);
  assert.equal(H1.attacks['stand-lp'].damage,8); assert.equal(s.fighters[0].attack.hitTargets.length,0);
});
test('Invalid frame intervals, missing attacks, boxes and nonfinite numbers fail before combat creation', () => {
  validateCharacter(H1);
  for(const mutate of [d=>d.attacks['stand-lp'].active=0,d=>d.attacks['stand-lp'].startup=1.5,
    d=>d.attacks['stand-lp'].damage=NaN,d=>d.attacks['stand-lp'].box.right=0,
    d=>delete d.attacks['crouch-hk'],d=>d.hurt.crouch.bottom=-130,d=>d.movement.gravity=Infinity]) {
    const bad=structuredClone(H1);mutate(bad);assert.throws(()=>createCombat([bad,H1]),/Invalid/);
  }
});
