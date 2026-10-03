import test from 'node:test';
import assert from 'node:assert/strict';
import { SOUND_SEQUENCES, comboSoundCues, allSoundCues } from '../src/audio/sound-sequences.ts';

test('S1 combo listening follows ordinary C hit intervals, not key press intervals', () => {
  assert.deepEqual(comboSoundCues(), [{ id: 'hit-lp', at: 0 }, { id: 'hit-hp', at: 13 / 60 }, { id: 'hit-lk', at: 24 / 60 }]);
});
test('S1 H36 landing and H12 escape examples are distinct from escape-only H0', () => {
  assert.deepEqual(SOUND_SEQUENCES.find(s => s.id === 'throw').cues, [{ id: 'grab-hold', at: 0 }, { id: 'grab-impact', at: .6 }]);
  assert.deepEqual(SOUND_SEQUENCES.find(s => s.id === 'escape').cues, [{ id: 'grab-hold', at: 0 }, { id: 'grab-escape', at: .2 }]);
  assert.deepEqual(SOUND_SEQUENCES.find(s => s.id === 'instant-escape').cues, [{ id: 'grab-escape', at: 0 }]);
});
test('S1 simultaneous example preserves both voices and full reel leaves a gap', () => {
  const simultaneous = SOUND_SEQUENCES.find(s => s.id === 'simultaneous').cues;
  assert.equal(simultaneous.length, 2); assert.deepEqual(simultaneous[0], simultaneous[1]);
  const cues = allSoundCues([{ id: 'a', durationMs: 100 }, { id: 'b', durationMs: 250 }]);
  assert.equal(cues[0].at, 0); assert.ok(cues[1].at >= .45 - 1e-9);
});
