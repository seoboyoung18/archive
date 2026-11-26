import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createH1Ai, stepH1Ai } from '../../../src/combat/h1-ai.ts';
import { stepH1AiMatch, observeH1Ai, transitionH1Ai } from '../../../src/combat/h1-ai-match.ts';
import { createMatch, startMatch, nextRound, resultReady } from '../../../src/combat/match.ts';
import { COMBAT_NEUTRAL as N } from '../../../src/combat/combat.ts';

const policies = ['idle', 'stand-guard', 'crouch-guard', 'approach-grab-repeat'];
const MAX_ROUND_ATTEMPTS = 5;
const clone = value => structuredClone(value);
const count = (object, key) => object[key] = (object[key] ?? 0) + 1;
const blank = () => ({ basicCommands: [{}, {}], observableBasicStarts: [{}, {}], grabCommands: [0, 0], techCommands: [0, 0],
  observableGrabAttempts: [0, 0], landedHits: [0, 0], blockedHits: [0, 0], declaredHitDamage: [0, 0],
  effectiveDamageTaken: [0, 0], whiffs: [0, 0], grabHolds: [0, 0], grabImpacts: [0, 0],
  grabEscapesInitiated: [0, 0], grabEscapesByTarget: [0, 0], cpuBackInputFrames: 0, cpuDecisionFrames: 0 });

function playerController(policy) {
  let releaseHands = false;
  return state => {
    const [p, cpu] = state.match.combat.fighters;
    const toward = cpu.x > p.x ? 1 : -1;
    if (policy === 'idle') return { ...N, handEvents: [] };
    if (policy === 'stand-guard') return { ...N, axis: -toward, handEvents: [] };
    if (policy === 'crouch-guard') return { ...N, axis: -toward, crouch: true, handEvents: [] };
    const axis = Math.abs(cpu.x - p.x) > 96 ? toward : 0;
    if (releaseHands) {
      releaseHands = false;
      return { ...N, axis, handEvents: [{ slot: 'hp', down: false }, { slot: 'lp', down: false }] };
    }
    if (p.action === 'free' && p.grounded && Math.abs(cpu.x - p.x) <= 96) {
      releaseHands = true;
      return { ...N, attacks: ['lp', 'hp'], handEvents: [{ slot: 'lp', down: true }, { slot: 'hp', down: true }] };
    }
    return { ...N, axis, handEvents: [] };
  };
}

function run(policy) {
  let state = { match: startMatch(createMatch()), ai: createH1Ai() };
  const rounds = [];
  for (let attempt = 1; attempt <= MAX_ROUND_ATTEMPTS; attempt++) {
    const control = playerController(policy), stats = blank(), events = [], grabTimeline = [];
    let firstDamageFrame = null, firstGrabFrame = null;
    const start = clone(state.match.combat.fighters.map(f => ({ x: f.x, hp: f.hp })));
    while (state.match.phase === 'playing') {
      const before = state, input = control(before), c = before.match.combat;
      // Read-only duplicate of the pure CPU choice for logging; only stepH1AiMatch advances state.
      const view = observeH1Ai(c, 1), cpuGrab = view.self.grab;
      const locked = view.self.action === 'grab' && !(cpuGrab?.kind === 'success' && cpuGrab.role === 'target' && cpuGrab.phase === 'hold');
      const choice = stepH1Ai(before.ai, () => view, locked);
      if (before.ai.untilDecision === 0) stats.cpuDecisionFrames++;
      if (choice.input.axis === (c.fighters[1].x > c.fighters[0].x ? 1 : -1)) stats.cpuBackInputFrames++;
      for (const [side, command] of [input, choice.input].entries()) {
        if (command.handEvents?.filter(event => event.down).length === 2) {
          if (c.fighters[side].grab?.kind === 'success' && c.fighters[side].grab.role === 'target') stats.techCommands[side]++;
          else stats.grabCommands[side]++;
        }
        else for (const slot of command.attacks) count(stats.basicCommands[side], `${command.crouch ? 'crouch' : 'stand'}-${slot}`);
      }
      state = stepH1AiMatch(before.match, before.ai, input);
      const next = state.match.combat;
      assert.equal(next.frame, c.frame + 1);
      assert.deepEqual(state.ai, transitionH1Ai(choice.ai, before.match, state.match));
      for (const side of [0, 1]) {
        const p = c.fighters[side], n = next.fighters[side];
        if (n.attack && n.attack.serial !== p.attack?.serial) count(stats.observableBasicStarts[side], n.attack.key);
        if (n.grab?.kind === 'attempt' && n.grab.age === 0 && n.grab.serial !== p.grab?.serial) stats.observableGrabAttempts[side]++;
        stats.effectiveDamageTaken[side] += p.hp - n.hp;
      }
      for (const event of next.events) {
        if (event.blocked) stats.blockedHits[event.attacker]++;
        else { stats.landedHits[event.attacker]++; stats.declaredHitDamage[event.attacker] += event.damage; firstDamageFrame ??= next.frame; }
        events.push({ frame: next.frame, kind: event.blocked ? 'block' : 'hit', ...event, hp: next.fighters.map(f => f.hp) });
      }
      for (const event of next.whiffEvents) stats.whiffs[event.attacker]++;
      for (const event of next.grabEvents) {
        if (event.kind === 'hold') { stats.grabHolds[event.attacker]++; firstGrabFrame ??= next.frame; }
        if (event.kind === 'impact') { stats.grabImpacts[event.attacker]++; firstDamageFrame ??= next.frame; }
        if (event.kind === 'escape') { stats.grabEscapesInitiated[event.attacker]++; stats.grabEscapesByTarget[event.target]++; }
        events.push({ frame: next.frame, ...event, hp: next.fighters.map(f => f.hp) });
      }
      if (input.attacks.length || choice.input.attacks.length || next.events.length || next.grabEvents.length
        || c.fighters.some((f, side) => f.grab?.kind === 'success' && next.fighters[side].grab === null)) {
        const visible = fighter => ({ x: fighter.x, hp: fighter.hp, action: fighter.action,
          attack: fighter.attack ? { key: fighter.attack.key, age: fighter.attack.age } : null,
          grab: fighter.grab ? { kind: fighter.grab.kind, role: fighter.grab.role, age: fighter.grab.age, id: fighter.grab.serial } : null });
        grabTimeline.push({ frame: next.frame, priorFrame: c.frame, playerInput: input, cpuInput: choice.input,
          cpuAiBefore: before.ai, cpuAiAfter: state.ai, before: c.fighters.map(visible), after: next.fighters.map(visible),
          events: [...next.events, ...next.grabEvents] });
      }
      assert.ok(next.frame <= 3600);
    }
    const cpuTechniques = Object.entries(stats.basicCommands[1]).map(([key, count]) => ({ key, count,
      percent: Number((count / Object.values(stats.basicCommands[1]).reduce((a, b) => a + b, 0) * 100).toFixed(2)) }));
    rounds.push({ attempt, displayedRound: state.match.round, start, result: state.match.result, wins: [...state.match.wins],
      elapsedFrames: state.match.combat.frame, elapsedSeconds: state.match.combat.frame / 60,
      remainingFrames: state.match.remainingFrames, hudSecondsRemaining: Math.ceil(state.match.remainingFrames / 60),
      hp: state.match.combat.fighters.map(f => f.hp), x: state.match.combat.fighters.map(f => f.x),
      firstDamageFrame, firstGrabFrame, stats, cpuTechniques, events, grabTimeline });
    while (!resultReady(state.match)) state = stepH1AiMatch(state.match, state.ai, N);
    if (state.match.phase === 'match-result' || attempt === MAX_ROUND_ATTEMPTS) break;
    const next = nextRound(state.match);
    state = { match: next, ai: transitionH1Ai(state.ai, state.match, next) };
  }
  return { policy, phase: state.match.phase, wins: state.match.wins,
    observationStopped: state.match.phase !== 'match-result' ? '5 round attempts reached; no winner forced' : null,
    totalCombatSeconds: rounds.reduce((sum, round) => sum + round.elapsedSeconds, 0), rounds };
}

const results = policies.map(policy => {
  const repeats = Array.from({ length: 3 }, () => run(policy));
  assert.deepEqual(repeats[0], repeats[1]); assert.deepEqual(repeats[1], repeats[2]);
  return { ...repeats[0], exactRepeatCount: repeats.length };
});
const sourcePaths = ['src/combat/h1-ai.ts', 'src/combat/h1-ai-match.ts', 'src/combat/combat.ts', 'src/combat/match.ts', 'src/characters/h1.ts'];
const report = { basis: 'Deterministic pure 60Hz simulation, not browser input or human difficulty assessment.',
  inspectedCommit: '2829de2 with AI-G implementation in the working tree; exact source hashes below',
  comparisonBaseline: 'docs/reviews/evidence/h1-ai-baseline.json retained unchanged; identical player policy and standard starting rules',
  randomness: 'No RNG or seed in approved AI; each unchanged standard-start policy repeated 3 times byte-equivalent.',
  standardStart: { playerX: 400, cpuX: 880, hp: [100,100], cpuCursor: 0, roundSeconds: 60, winsRequired: 2 },
  policy: { idle: 'neutral every tick', 'stand-guard': 'away axis held, standing; includes normal backward movement',
    'crouch-guard': 'away axis and crouch held',
    'approach-grab-repeat': 'public distance >96: walk toward; when own visible action is free and grounded at distance<=96: fresh U/I down together, up next tick; otherwise neutral. Frame-perfect scripted timing, no manual HP/position injection.' },
  logging: { sideOrder: ['PLAYER', 'CPU'], basicCommands: 'CPU input selections, including a same-tick capture or interruption before an attack remains visible',
    observableBasicStarts: 'New attack instance visible after common resolution', blockedHits: 'Blocked contacts indexed by attacker, not successful guards by that side',
    grabEscapesByTarget: 'Escape events indexed by grabbed target', combatTime: 'Playing ticks only, excludes KO result animation and manual transition time',
    drawLimit: 'After 5 attempts stop observation; the engine remains in round-result and no victor is fabricated',
    timelineFrames: 'frame is the post-tick combat.frame (first processed tick is 1); grab age0 is H0 at capture. before state is priorFrame. Logs may inspect ages, but the scripted policy does not use them.' },
  sourceSha256: Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(new URL(`../../../${path}`, import.meta.url))).digest('hex')])),
  results };
writeFileSync(new URL('./h1-ai-grab-after.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.table(results.map(result => ({ policy: result.policy, wins: result.wins.join(':'), phase: result.phase,
  attempts: result.rounds.length, seconds: result.totalCombatSeconds, firstRoundHP: result.rounds[0].hp.join(':'),
  firstRoundSeconds: result.rounds[0].elapsedSeconds, cpuAttackCommands: result.rounds[0].cpuTechniques.reduce((sum, item) => sum + item.count, 0),
  playerBlocked: result.rounds[0].stats.blockedHits[1], playerGrabCommands: result.rounds[0].stats.grabCommands[0],
  playerGrabHolds: result.rounds[0].stats.grabHolds[0], cpuEscapes: result.rounds[0].stats.grabEscapesByTarget[1] })));
for (const result of results) console.log(JSON.stringify({ policy: result.policy,
  firstRoundTechniques: result.rounds[0].cpuTechniques,
  firstRoundStats: result.rounds[0].stats,
  firstRoundGrabEvents: result.rounds[0].events.filter(event => ['hold','impact','escape'].includes(event.kind)) }));
