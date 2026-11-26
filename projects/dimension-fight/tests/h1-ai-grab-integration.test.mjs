import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombat, stepCombat, COMBAT_NEUTRAL as N } from '../src/combat/combat.ts';
import { createMatch, startMatch, pauseMatch, nextRound, restartMatch, resultReady } from '../src/combat/match.ts';
import { createH1Ai, stepH1Ai } from '../src/combat/h1-ai.ts';
import { observeH1Ai, stepH1AiMatch, transitionH1Ai } from '../src/combat/h1-ai-match.ts';
import { CombatSoundCursor } from '../src/audio/combat-sound-cues.ts';

const crouchGuard = { ...N, axis: -1, crouch: true };
const CHORD = { ...N, attacks: ['lp', 'hp'], handEvents: [
  { slot: 'lp', down: true }, { slot: 'hp', down: true },
  { slot: 'hp', down: false }, { slot: 'lp', down: false },
] };
const tick = (state, player = N) => stepH1AiMatch(state.match, state.ai, player);
const transition = (state, match) => ({ match, ai: transitionH1Ai(state.ai, state.match, match) });
function tracedTick(state, player = N) {
  const observed = observeH1Ai(state.match.combat, 1), g = observed.self.grab;
  const locked = observed.self.action === 'grab' && !(g?.kind === 'success' && g.role === 'target' && g.phase === 'hold');
  const choice = stepH1Ai(state.ai, () => observed, locked), next = tick(state, player);
  assert.deepEqual(next.ai, transitionH1Ai(choice.ai, state.match, next.match));
  return { state: next, input: choice.input };
}
function captured(phase = 0, reversed = false, attacker = 0) {
  let combat = createCombat();
  combat.fighters[0].x = reversed ? 584 : 500;
  combat.fighters[1].x = reversed ? 500 : 584;
  combat = stepCombat(combat, attacker === 0 ? [CHORD, N] : [N, CHORD]);
  for (let age = 1; age <= 6; age++) combat = stepCombat(combat, [N, N]);
  assert.equal(combat.grabPair?.age, 0);
  return { match: { ...startMatch(createMatch()), combat, remainingFrames: 3600 - combat.frame },
    ai: { ...createH1Ai(), untilDecision: phase } };
}
function secondCapture(state) {
  // Real first throw, walk after H54, start the next throw at H66, catch at the target's H72 release.
  const toward = state.match.combat.fighters[1].x > state.match.combat.fighters[0].x ? 1 : -1;
  for (let age = 1; age <= 72; age++) {
    state = tick(state, age >= 54 && age <= 65 ? { ...N, axis: toward } : age === 66 ? CHORD : N);
    if (age < 72) assert.ok(!state.match.combat.grabEvents.some(event => event.kind === 'escape'));
  }
  assert.equal(state.ai.captureCount, 1);
  assert.equal(state.match.combat.grabPair?.age, 0);
  assert.equal(state.match.combat.grabPair.serial, 2);
  assert.equal(state.match.combat.fighters[1].hp, 82);
  return state;
}

test('AI-G integration: standard-start crouch guard receives a real CPU throw through common match inputs', () => {
  let state = { match: startMatch(createMatch()), ai: createH1Ai() };
  const grabs = [];
  while (state.match.phase === 'playing') {
    state = stepH1AiMatch(state.match, state.ai, crouchGuard);
    grabs.push(...state.match.combat.grabEvents);
  }
  assert.ok(grabs.some(event => event.kind === 'hold' && event.attacker === 1), 'CPU must actually capture');
  assert.ok(grabs.some(event => event.kind === 'impact' && event.attacker === 1 && event.damage === 18), 'CPU throw uses the normal impact');
  assert.ok(state.match.combat.fighters[0].hp < 100);
});

test('AI-G integration: every 12F phase allows the first capture and escapes the second exactly once at H1..12', () => {
  const applicationAges = new Set();
  for (const reversed of [false, true]) for (let phase = 0; phase < 12; phase++) {
    let state = secondCapture(captured(phase, reversed));
    const firstRelation = { ...state.ai.lastCapture }, heard = [], sounds = new CombatSoundCursor();
    heard.push(...sounds.consume(state.match.combat));
    const techInputs = [], escapes = [];
    for (let age = 1; age <= 24; age++) {
      const result = tracedTick(state); state = result.state;
      if (result.input.attacks.length === 2) { assert.deepEqual(result.input, CHORD); techInputs.push(age); }
      escapes.push(...state.match.combat.grabEvents.filter(event => event.kind === 'escape').map(() => age));
      heard.push(...sounds.consume(state.match.combat));
    }
    assert.deepEqual(techInputs, [phase + 1], `phase ${phase}, reversed ${reversed}`);
    assert.deepEqual(escapes, [phase + 1]); applicationAges.add(escapes[0]);
    assert.equal(state.ai.captureCount, 2);
    assert.deepEqual(firstRelation, { owner: 0, serial: 1 });
    assert.deepEqual(state.ai.lastCapture, { owner: 0, serial: 2 });
    assert.equal(state.match.combat.fighters[1].hp, 82, 'second capture adds no throw damage');
    assert.deepEqual(heard.filter(cue => cue.id.startsWith('grab-')).map(cue => cue.id), ['grab-hold', 'grab-escape']);
  }
  assert.deepEqual([...applicationAges].sort((a,b) => a-b), [1,2,3,4,5,6,7,8,9,10,11,12]);
});

test('AI-G integration: H11/H12 observations use the pair phase, while common H12/H13 input resolution remains authoritative', () => {
  for (const observeAge of [11,12,13,19,20,35,36,54,71]) {
    let state = secondCapture(captured());
    // A deliberate late-observer fixture isolates the documented H12→H13 boundary.
    let combat = state.match.combat;
    for (let age = 1; age <= observeAge; age++) combat = stepCombat(combat, [N,N]);
    state = { match: { ...state.match, combat }, ai: { ...state.ai, untilDecision: 0 } };
    const view = observeH1Ai(combat, 1);
    assert.equal(view.self.grab.phase, observeAge <= 12 ? 'hold' : observeAge < 36 ? 'throw' : 'down');
    assert.equal('age' in view.self.grab, false);
    assert.equal('hands' in view.self, false);
    const result = tracedTick(state); state = result.state;
    assert.equal(result.input.attacks.length, observeAge <= 12 ? 2 : 0);
    assert.equal(state.match.combat.grabEvents.some(event => event.kind === 'escape'), observeAge === 11);
    if (observeAge === 12) {
      assert.equal(state.ai.captureCount, 2);
      for (let age = 14; age <= 36; age++) {
        const next = tracedTick(state); state = next.state;
        assert.equal(next.input.attacks.length, 0, 'failed late tech is never retried in that relationship');
      }
      assert.equal(state.match.combat.fighters[1].hp, 64);
    }
  }
});

test('AI-G integration: CPU attempt/attacker/throw/down/escape locks stay neutral while clocks continue', () => {
  const scenes = [];
  let attempt = createCombat(); attempt = stepCombat(attempt, [N, CHORD]);
  scenes.push({ ...captured(), match: { ...startMatch(createMatch()), combat: attempt } });
  scenes.push(captured(0, false, 1));
  for (const age of [13,36,60]) {
    let state = captured();
    for (let i = 0; i < age; i++) state.match = { ...state.match, combat: stepCombat(state.match.combat, [N,N]) };
    scenes.push(state);
  }
  let escape = captured(0, false, 1);
  escape.match = { ...escape.match, combat: stepCombat(escape.match.combat, [CHORD,N]) };
  scenes.push(escape);
  for (let state of scenes) {
    state = { ...state, ai: { ...state.ai, grabCooldown: 70, axis: 1, crouch: true } };
    const result = tracedTick(state);
    assert.deepEqual(result.input, N);
    assert.equal(result.state.ai.untilDecision, 11);
    assert.equal(result.state.ai.grabCooldown, 69);
    assert.equal(result.state.ai.captureCount, 0, 'non-hold locks do not count as newly observed capture');
    assert.equal(result.state.ai.lastCapture, null);
  }
});

test('AI-G integration: failed throws, simultaneous clashes and H0 escape never become observed successful captures', () => {
  for (const outcome of ['miss','clash','h0-escape']) {
    let combat = createCombat();
    combat.fighters[0].x = 500; combat.fighters[1].x = outcome === 'miss' ? 700 : 584;
    combat = stepCombat(combat, [CHORD, outcome === 'clash' ? CHORD : N]);
    for (let age = 1; age <= 5; age++) combat = stepCombat(combat, [N,N]);
    combat = stepCombat(combat, [N, outcome === 'h0-escape' ? CHORD : N]);
    assert.equal(combat.grabPair, null);
    assert.deepEqual(combat.grabEvents.map(event => event.kind), outcome === 'miss' ? [] : ['escape']);
    let state = { match: { ...startMatch(createMatch()), combat }, ai: createH1Ai() };
    for (let i = 0; i < 13; i++) state = tick(state);
    assert.equal(state.ai.captureCount, 0, outcome);
    assert.equal(state.ai.lastCapture, null, outcome);
  }
});

test('AI-G integration: actual CPU throw waits through H54..H72 and uses only common hold/impact sound events', () => {
  let state = { match: startMatch(createMatch()), ai: createH1Ai() };
  const sounds = new CombatSoundCursor(), heard = [];
  let holdFrame = null, cpuReleasedX = null, firstAfterWake = null;
  while (state.match.phase === 'playing') {
    const result = tracedTick(state, crouchGuard); state = result.state;
    const combat = state.match.combat;
    heard.push(...sounds.consume(combat).map(cue => ({ ...cue, frame: combat.frame })));
    const hold = combat.grabEvents.find(event => event.kind === 'hold' && event.attacker === 1);
    if (hold && holdFrame === null) holdFrame = combat.frame;
    if (holdFrame === null) continue;
    const age = combat.frame - holdFrame;
    if (age === 54) cpuReleasedX = combat.fighters[1].x;
    if (age >= 54 && age <= 72) {
      assert.deepEqual(result.input, N, `H${age}`);
      assert.equal(combat.fighters[1].x, cpuReleasedX);
      assert.equal(combat.fighters[1].attack, null);
    }
    if (age > 72 && (result.input.axis || result.input.attacks.length)) { firstAfterWake = age; break; }
  }
  assert.notEqual(holdFrame, null);
  assert.ok(firstAfterWake > 72 && firstAfterWake <= 84);
  assert.deepEqual(heard.filter(cue => cue.id.startsWith('grab-')).map(cue => [cue.id, cue.frame-holdFrame]),
    [['grab-hold',0],['grab-impact',36]]);
});

test('AI-G integration: real CPU attempts maintain at least 120F gaps after success, miss, or a player escape', () => {
  for (const response of ['hold','escape','jump']) {
    let state = { match: startMatch(createMatch()), ai: createH1Ai() }, firstAttempt = null;
    const attempts = [], inputs = [], effects = [];
    for (let tickNumber = 0; tickNumber < 600 && state.match.phase === 'playing'; tickNumber++) {
      const cpu = state.match.combat.fighters[1], player = state.match.combat.fighters[0];
      let command = crouchGuard;
      if (response === 'jump' && cpu.grab?.kind === 'attempt') command = { ...N, jump: true };
      if (response === 'escape' && player.grab?.kind === 'success' && player.grab.role === 'target' && player.grab.age === 0) command = CHORD;
      const result = tracedTick(state, command); state = result.state;
      inputs.push(result.input);
      effects.push(...state.match.combat.grabEvents);
      if (result.input.attacks.length === 2) {
        assert.deepEqual(result.input, CHORD); attempts.push(state.match.combat.frame); firstAttempt ??= state.match.combat.frame;
        assert.equal(state.ai.grabCooldown, 120);
      }
      if (firstAttempt !== null && state.match.combat.frame - firstAttempt < 120) {
        assert.equal(state.ai.grabCooldown, 120 - (state.match.combat.frame - firstAttempt));
      }
    }
    assert.ok(attempts.length >= 2, response);
    for (let i = 1; i < attempts.length; i++) assert.ok(attempts[i] - attempts[i-1] >= 120, `${response}: ${attempts}`);
    assert.ok(inputs.some(input => input.attacks.length === 1), 'normal attacks still occur between attempts');
    if (response === 'hold') assert.ok(effects.some(event => event.kind === 'impact'));
    if (response === 'escape') assert.ok(effects.some(event => event.kind === 'escape'));
  }
});

test('AI-G integration: pause before/after observing a capture preserves policy and does not duplicate tech on resume', () => {
  for (const checkpoint of ['before-observation','after-first-observation','after-tech']) {
    let state = checkpoint === 'after-first-observation' ? captured() : secondCapture(captured(5));
    if (checkpoint === 'after-first-observation') state = tick(state);
    if (checkpoint === 'after-tech') {
      for (let i = 0; i < 6; i++) state = tick(state);
      assert.equal(state.match.combat.grabEvents[0]?.kind, 'escape');
    }
    const before = structuredClone(state.ai);
    state = transition(state, pauseMatch(state.match, true));
    assert.deepEqual(state.ai, { ...before, axis: 0, crouch: false });
    const frozen = structuredClone(state);
    for (let i = 0; i < 120; i++) state = tick(state, CHORD);
    assert.deepEqual(state, frozen);
    state = transition(state, pauseMatch(state.match, false));
    let escapes = 0;
    for (let i = 0; i < 24; i++) { state = tick(state); escapes += state.match.combat.grabEvents.filter(event => event.kind === 'escape').length; }
    assert.equal(escapes, checkpoint === 'before-observation' ? 1 : 0);
    assert.equal(state.ai.captureCount, checkpoint === 'after-first-observation' ? 1 : 2);
  }
});

test('AI-G integration: timeout/KO freeze policy and replay/new round/restart reset even reused round numbers and relation IDs', () => {
  for (const ending of ['tie','timeout','ko']) {
    let state = tick(captured()); // A real first observation populates the policy history.
    state.ai = { ...state.ai, grabCooldown: 50 };
    if (ending === 'ko') {
      state.match.combat.fighters[1].hp = 18;
      for (let age = 2; age <= 36; age++) state = tick(state);
    } else {
      state.match.remainingFrames = 1;
      if (ending === 'timeout') state.match.combat.fighters[1].hp = 99;
      state = tick(state);
    }
    assert.equal(state.match.result.reason, ending === 'tie' ? 'timeout-tie' : ending);
    const frozenAi = structuredClone(state.ai), frame = state.match.combat.frame;
    for (let i = 0; i < 120; i++) state = tick(state, CHORD);
    assert.deepEqual(state.ai, frozenAi); assert.equal(state.match.combat.frame, frame);
    assert.ok(resultReady(state.match));
    const oldRound = state.match.round;
    state = transition(state, nextRound(state.match));
    assert.equal(state.match.round, oldRound + (ending === 'tie' ? 0 : 1));
    assert.deepEqual(state.ai, createH1Ai());
    // Finish a real pair of timeout wins, then exercise the public full-match reset.
    while (state.match.phase !== 'match-result') {
      state.match.remainingFrames = 1; state.match.combat.fighters[1].hp = 50;
      state = tick(state);
      if (state.match.phase === 'round-result') state = transition(state, nextRound(state.match));
    }
    state = transition(state, restartMatch(state.match));
    assert.equal(state.match.phase, 'ready'); assert.deepEqual(state.ai, createH1Ai());
    const duplicate = transitionH1Ai(state.ai, state.match, restartMatch(state.match));
    assert.equal(duplicate, state.ai);
  }
});
