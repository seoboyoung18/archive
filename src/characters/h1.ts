import type { CharacterDefinition } from '../combat/definition.ts';
import { H1_MOVEMENT } from '../combat/movement.ts';

/** Approved H1 combat v0.3; coordinates are relative to the fighter's foot root. */
export const H1: CharacterDefinition = {
  id: 'h1', maxHp: 100, movement: H1_MOVEMENT,
  hurt: {
    stand: { left: -36, right: 36, top: -220, bottom: 0 },
    crouch: { left: -36, right: 36, top: -120, bottom: 0 },
  },
  attacks: {
    'stand-lp': { startup: 6, active: 3, recovery: 15, damage: 8, hitstun: 16, blockstun: 8, push: 24, blockPush: 8, height: 'normal', box: { left: 36, right: 104, top: -190, bottom: -100 } },
    'stand-hp': { startup: 10, active: 3, recovery: 21, damage: 12, hitstun: 20, blockstun: 10, push: 36, blockPush: 12, height: 'normal', box: { left: 36, right: 124, top: -190, bottom: -100 } },
    'stand-lk': { startup: 8, active: 4, recovery: 18, damage: 10, hitstun: 18, blockstun: 10, push: 32, blockPush: 10, height: 'normal', box: { left: 36, right: 134, top: -155, bottom: -65 } },
    'stand-hk': { startup: 12, active: 4, recovery: 36, damage: 16, hitstun: 24, blockstun: 12, push: 48, blockPush: 16, height: 'overhead', box: { left: 36, right: 154, top: -155, bottom: -65 } },
    'crouch-lp': { startup: 6, active: 3, recovery: 15, damage: 6, hitstun: 16, blockstun: 8, push: 24, blockPush: 8, height: 'normal', box: { left: 36, right: 96, top: -115, bottom: -65 } },
    'crouch-hp': { startup: 10, active: 3, recovery: 21, damage: 10, hitstun: 20, blockstun: 10, push: 36, blockPush: 12, height: 'normal', box: { left: 36, right: 112, top: -115, bottom: -65 } },
    'crouch-lk': { startup: 8, active: 4, recovery: 18, damage: 8, hitstun: 18, blockstun: 10, push: 32, blockPush: 10, height: 'low', box: { left: 36, right: 124, top: -60, bottom: -10 } },
    'crouch-hk': { startup: 14, active: 4, recovery: 24, damage: 14, hitstun: 24, blockstun: 12, push: 48, blockPush: 16, height: 'low', box: { left: 36, right: 144, top: -60, bottom: -10 } },
  },
};
