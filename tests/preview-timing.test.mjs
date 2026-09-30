import test from 'node:test';
import assert from 'node:assert/strict';
import { phaseAtTick } from '../src/preview-timing.ts';

test('Standing light punch: 6/3/15 frames, then inspector idle gap', () => {
  for (const [tick, expected] of [[0,'startup'],[5,'startup'],[6,'active'],[8,'active'],[9,'recovery'],[23,'recovery'],[24,'idle'],[53,'idle'],[54,'startup']]) {
    assert.equal(phaseAtTick(tick, [6,3,15]), expected, `tick ${tick}`);
  }
});
test('Crouching light kick: 8/4/18 frames, not punch timing', () => {
  for (const [tick, expected] of [[0,'startup'],[7,'startup'],[8,'active'],[11,'active'],[12,'recovery'],[29,'recovery'],[30,'idle'],[59,'idle'],[60,'startup']]) {
    assert.equal(phaseAtTick(tick, [8,4,18]), expected, `tick ${tick}`);
  }
});
